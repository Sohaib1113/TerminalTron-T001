import { execFile } from 'child_process';
import { existsSync, readdirSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * Offline speech-to-text for the desktop app.
 *
 * PRIMARY ENGINE — Whisper (whisper.cpp). A vendored `whisper-cli.exe` plus a
 * ggml model under `vendor/whisper/` transcribes 16 kHz mono WAV locally with
 * modern neural accuracy. Whisper is an unconstrained acoustic model, so it
 * hears ordinary conversation correctly — Windows' legacy recogniser did not
 * ("what you can do for me" came back as "who can eat your he had any"). The
 * allowlist is injected only as a SOFT decoding bias (`--prompt`), never as a
 * hard grammar, so known names stay reachable without command vocabulary
 * leaking into free speech.
 *
 * FALLBACK ENGINE — Windows System.Speech via PowerShell, used only when the
 * vendored engine is missing (e.g. a checkout without `vendor/whisper`). It
 * loads TWO grammars side by side (a constrained command grammar built from the
 * allowlist and a plain DictationGrammar), keeps the n-best hypotheses,
 * re-ranks them against the vocabulary, then repairs residual near-misses with
 * a snap pass.
 */

const MAX_WAV_BYTES = 15 * 1024 * 1024; // ~30s of 16 kHz mono is ~1 MB

const COMMAND_GRAMMAR = 'ultron-command';

/** Vendored whisper.cpp executable + default model, relative to `vendor/whisper`. */
const WHISPER_EXE = 'whisper-cli.exe';
const DEFAULT_WHISPER_MODEL = 'ggml-base.en.bin';
/** Hard cap on how long the recogniser may run before we give up. */
const WHISPER_TIMEOUT_MS = 60000;

/**
 * Locate the vendored `whisper-cli.exe`. Checked in order: an explicit override,
 * then by walking up from this file (covers both `src/` in dev and the compiled
 * `dist/` tree), then the process CWD, then Electron's packaged resources.
 * Returns null when no engine is present so the caller can fall back.
 */
const resolveWhisperDir = (): string | null => {
  const override = process.env.ULTRON_WHISPER_DIR;
  if (override) {
    return existsSync(path.join(override, WHISPER_EXE)) ? override : null;
  }
  const candidates: string[] = [];
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    candidates.push(path.join(dir, 'vendor', 'whisper'));
    dir = path.dirname(dir);
  }
  candidates.push(path.join(process.cwd(), 'vendor', 'whisper'));
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'vendor', 'whisper'));
  }
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, WHISPER_EXE))) {
      return candidate;
    }
  }
  return null;
};

/**
 * Resolve the ggml model: an explicit override (absolute, or a filename inside
 * the whisper dir), else the default, else any `ggml-*.bin` sitting alongside
 * the executable — so dropping in `ggml-small.en.bin` just works.
 */
const resolveWhisperModel = (dir: string): string | null => {
  const override = process.env.ULTRON_WHISPER_MODEL;
  if (override) {
    const resolved = path.isAbsolute(override) ? override : path.join(dir, override);
    return existsSync(resolved) ? resolved : null;
  }
  const preferred = path.join(dir, DEFAULT_WHISPER_MODEL);
  if (existsSync(preferred)) {
    return preferred;
  }
  try {
    const found = readdirSync(dir).find((name) => /^ggml-.*\.bin$/i.test(name));
    return found ? path.join(dir, found) : null;
  } catch {
    return null;
  }
};

/**
 * Build Whisper's initial prompt from the allowlist. This is only a soft
 * decoding bias that nudges brand names toward their real spelling — it is
 * capped short because a long list costs context tokens and can make the model
 * hallucinate those names during silence.
 */
const buildWhisperPrompt = (vocabulary: string[]): string => {
  const terms = Array.from(
    new Set(vocabulary.filter((word) => word && word.length > 1).map((word) => word.toLowerCase())),
  ).slice(0, 50);
  return terms.length ? terms.join(', ') : '';
};

/**
 * Collapse whisper-cli stdout into one transcript line. With `-nt` there are no
 * timestamps; each segment is printed on its own line with a leading space.
 */
export const parseWhisperOutput = (stdout: string): string =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('['))
    .join(' ')
    .trim();

/**
 * Whisper's well-known failure mode is emitting a short filler during silence
 * ("you", "Thank you.", "Thanks for watching!"). A bare one of these is far
 * more likely to be a hallucination than real speech, so it is treated as
 * silence. The renderer also gates on detected speech energy; this is a
 * defence-in-depth guard for faint-noise captures.
 */
const SILENCE_HALLUCINATIONS = new Set([
  'you',
  'thankyou',
  'thanksforwatching',
  'pleasesubscribe',
  'subscribe',
  'bye',
  'okay',
  'yeah',
  'hmm',
  'uh',
  'um',
]);

const isSilenceHallucination = (text: string): boolean => {
  const normalized = text.toLowerCase().replace(/[^a-z]/g, '');
  return normalized.length === 0 || SILENCE_HALLUCINATIONS.has(normalized);
};

const psString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * Emits `(New-Object Type @('a', 'b'))` — the array-ctor form proven to bind.
 * The outer parentheses are mandatory: PowerShell cannot parse a bare
 * `New-Object` expression inside a method call (e.g. `.Append(New-Object …, 0, 1)`),
 * but parses the same token fine when it is a parenthesized sub-expression.
 */
const psChoices = (typeName: string, items: string[]): string =>
  `(New-Object ${typeName} @(${items.map(psString).join(', ')}))`;

/** Verbs accepted by the constrained command grammar. */
const COMMAND_VERBS = [
  'open', 'launch', 'start', 'go to', 'visit', 'play', 'search for', 'browse',
  'show', 'pull up', 'bring up', 'take me to', 'fire up', 'get',
];

/** Optional polite lead-ins the recogniser may (but need not) hear. */
const COMMAND_PREFIXES = [
  'please', 'hey terminatron', 'terminatron', 'hey terminal tron', 'terminal tron',
  'can you', 'could you', 'would you', 'okay', 'ok', 'yeah',
];

/** Trailing filler, including every "in/on [the] <browser> [browser]" shape. */
const COMMAND_SUFFIXES = [
  'browser', 'website', 'site', 'for me', 'please', 'up',
  'in brave', 'in chrome', 'in edge', 'in firefox',
  'on brave', 'on chrome', 'on edge', 'on firefox',
  'in the brave browser', 'in the chrome browser', 'in the edge browser', 'in the firefox browser',
  'on the brave browser', 'on the chrome browser', 'on the edge browser', 'on the firefox browser',
  'on brave browser', 'on chrome browser', 'on edge browser', 'on firefox browser',
  'in brave browser', 'in chrome browser', 'in edge browser', 'in firefox browser',
];

/**
 * Words the snap pass must NEVER rewrite: command-grammar glue, lead-ins, and
 * common chat function words. Without this, correct speech gets "corrected"
 * ("open" → openai, "bring" → bing, "doing" → bing — all within edit
 * distance of a vocabulary entry).
 */
const SNAP_PROTECTED = new Set([
  // Command verbs + glue
  'open', 'launch', 'start', 'go', 'to', 'visit', 'play', 'search', 'browse',
  'show', 'pull', 'bring', 'take', 'fire', 'get', 'up', 'the', 'a', 'an',
  'app', 'application', 'page', 'site', 'website', 'browser', 'for', 'me',
  'my', 'in', 'on', 'using', 'with', 'via', 'through', 'inside', 'any',
  'default', 'please', 'hey', 'terminatron', 'terminal', 'tron', 'can', 'could', 'would', 'ok',
  'okay', 'yeah', 'kindly',
  // Common chat function words (observed false positives first)
  'i', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did',
  'doing', 'done', 'what', 'when', 'where', 'why', 'who', 'how', 'which',
  'this', 'that', 'these', 'those', 'it', 'its', 'your', 'we', 'our', 'us',
  'they', 'them', 'he', 'she', 'his', 'her', 'of', 'and', 'but', 'if',
  'then', 'than', 'so', 'no', 'not', 'yes', 'down', 'out', 'off', 'all',
  'some', 'more', 'most', 'other', 'into', 'over', 'under', 'again',
  'there', 'here', 'now', 'just', 'also', 'very', 'too', 'only', 'will',
  'one', 'make', 'said', 'like', 'time', 'know', 'see', 'come', 'should',
  'may', 'might', 'must', 'let', 'well', 'back', 'even', 'still', 'way',
  'many', 'got', 'think', 'want', 'need', 'help', 'thanks', 'thank',
  'hello', 'hi', 'about', 'right', 'give', 'look', 'use', 'try', 'keep',
]);

/**
 * PowerShell payload. Loads BOTH grammars, runs recognition, and writes a JSON
 * sidecar: {"candidates":[{"text","grammar","confidence"}, …]} — top result
 * first, then n-best alternates, so Node can re-rank against the vocabulary.
 * Errors are written as {"error": "..."} to the same sidecar (we never fight
 * with the console codepage on stdout).
 *
 * @internal exported for tests/diagnostics.
 */
export const buildScript = (wavPath: string, outPath: string, vocabulary: string[]): string => [
  "$ErrorActionPreference = 'Stop'",
  `$wav = ${psString(wavPath)}`,
  `$out = ${psString(outPath)}`,
  '$utf8 = New-Object System.Text.UTF8Encoding($false)',
  'try {',
  '  Add-Type -AssemblyName System.Speech',
  '  $recs = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()',
  '  if ($recs.Count -eq 0) {',
  "    [System.IO.File]::WriteAllText($out, '{\"error\":\"No speech recogniser is installed on this Windows system.\"}', $utf8)",
  '    exit 2',
  '  }',
  // Prefer an exact en-US pack, then any English pack, then anything at all —
  // the recogniser culture must match how the audio was captured (en-US).
  "  $pick = $recs | Where-Object { $_.Culture.Name -eq 'en-US' } | Select-Object -First 1",
  "  if (-not $pick) { $pick = $recs | Where-Object { $_.Culture.Name -like 'en*' } | Select-Object -First 1 }",
  '  if (-not $pick) { $pick = $recs[0] }',
  '  $eng = New-Object System.Speech.Recognition.SpeechRecognitionEngine($pick.Id)',
  '  $eng.InitialSilenceTimeout = [TimeSpan]::FromSeconds(12)',
  '  $eng.BabbleTimeout = [TimeSpan]::FromSeconds(12)',
  '',
  '  # Grammar 1: [prefix?] verb known-word [suffix?] — constrains commands so',
  '  # the recogniser cannot mangle allowlisted names ("netflix" vs "flicks").',
  `  $verbs = ${psChoices('System.Speech.Recognition.Choices', COMMAND_VERBS)}`,
  `  $sites = ${psChoices('System.Speech.Recognition.Choices', vocabulary)}`,
  '  $pre = New-Object System.Speech.Recognition.GrammarBuilder',
  `  $pre.Append(${psChoices('System.Speech.Recognition.Choices', COMMAND_PREFIXES)}, 0, 1)`,
  '  $core = New-Object System.Speech.Recognition.GrammarBuilder',
  '  $core.Append($verbs)',
  // Optional filler ("open *the* calculator", "calculator *app*") — without
  // these, natural phrasings fall through to the unconstrained dictation
  // grammar and allowlisted names get mangled ("lunch the calculator up").
  `  $core.Append(${psChoices('System.Speech.Recognition.Choices', ['the', 'a', 'an'])}, 0, 1)`,
  '  $core.Append($sites)',
  `  $core.Append(${psChoices('System.Speech.Recognition.Choices', ['app', 'application', 'page'])}, 0, 1)`,
  '  $suf = New-Object System.Speech.Recognition.GrammarBuilder',
  `  $suf.Append(${psChoices('System.Speech.Recognition.Choices', COMMAND_SUFFIXES)}, 0, 1)`,
  '  $cmd = New-Object System.Speech.Recognition.GrammarBuilder',
  '  $cmd.Append($pre)',
  '  $cmd.Append($core)',
  '  $cmd.Append($suf)',
  '  $cmdGrammar = New-Object System.Speech.Recognition.Grammar($cmd)',
  `  $cmdGrammar.Name = ${psString(COMMAND_GRAMMAR)}`,
  '',
  '  # Grammar 2: free dictation for conversational turns.',
  '  $dict = New-Object System.Speech.Recognition.DictationGrammar',
  "  $dict.Name = 'ultron-dictation'",
  '',
  '  $eng.LoadGrammar($cmdGrammar)',
  '  $eng.LoadGrammar($dict)',
  '  $eng.SetInputToWaveFile($wav)',
  '  $res = $eng.Recognize()',
  '  $eng.Dispose()',
  '  # Keep the top hypothesis plus n-best alternates; Node re-ranks them.',
  '  $cands = @()',
  '  if ($res) {',
  '    $gname = if ($res.Grammar) { $res.Grammar.Name } else { "" }',
  '    $cands += [pscustomobject]@{ text = [string]$res.Text; grammar = [string]$gname; confidence = [double]$res.Confidence }',
  '    foreach ($alt in $res.Alternates) {',
  '      $aname = if ($alt.Grammar) { $alt.Grammar.Name } else { "" }',
  '      $cands += [pscustomobject]@{ text = [string]$alt.Text; grammar = [string]$aname; confidence = [double]$alt.Confidence }',
  '    }',
  '  }',
  '  $json = ConvertTo-Json -InputObject @{ candidates = $cands } -Compress -Depth 4',
  '  [System.IO.File]::WriteAllText($out, $json, $utf8)',
  '} catch {',
  '  $msg = $_.Exception.Message.Replace(\'"\', \'\\\\\"\')',
  "  [System.IO.File]::WriteAllText($out, ('{\"error\": \"' + $msg + '\"}'), $utf8)",
  '  exit 1',
  '}',
].join('\n');

const assertWav = (wav: Buffer): void => {
  if (wav.length < 44 || wav.length > MAX_WAV_BYTES) {
    throw new Error('Audio payload is missing or too large (max 15 MB).');
  }
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Audio payload is not a WAV file.');
  }
};

/** One recogniser hypothesis (top result or an n-best alternate). */
export interface SttCandidate {
  text: string;
  grammar: string;
  confidence: number;
}

/** Small edit-distance helper for the vocabulary snap pass. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

/** Count how many vocabulary entries a candidate gets right. */
const vocabularyHits = (text: string, vocabulary: string[]): number => {
  const lower = ` ${text.toLowerCase()} `;
  const squashed = lower.replace(/[^a-z0-9]+/g, '');
  let hits = 0;
  for (const word of vocabulary) {
    if (!word) continue;
    if (word.includes(' ')) {
      if (lower.includes(` ${word} `)) hits += 1;
    } else if (lower.includes(` ${word} `) || squashed.includes(word)) {
      hits += 1;
    }
  }
  return hits;
};

/**
 * Re-rank recogniser hypotheses: vocabulary hits dominate, the constrained
 * command grammar gets a tie-break bonus (it can only emit allowlisted words),
 * and raw confidence decides otherwise. Free-form chat (zero hits everywhere)
 * falls through to plain confidence — the old behaviour.
 *
 * @internal exported for tests.
 */
export const pickBestCandidate = (candidates: SttCandidate[], vocabulary: string[]): string => {
  const usable = candidates.filter((c) => c.text && c.text.trim());
  if (!usable.length) return '';
  let best = usable[0];
  let bestScore = -Number.POSITIVE_INFINITY;
  for (const candidate of usable) {
    const hits = vocabularyHits(candidate.text, vocabulary);
    const confidence = Number.isFinite(candidate.confidence)
      ? Math.max(0, Math.min(1, candidate.confidence))
      : 0;
    const grammarBonus = candidate.grammar === COMMAND_GRAMMAR ? 0.35 : 0;
    const score = hits * 10 + grammarBonus + confidence;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return snapToVocabulary(best.text.trim(), vocabulary);
};

/**
 * Repair residual near-misses in the winning transcript: split spellings
 * ("net flix"), typos ("calculater"), and phonetic slips ("goggle") within
 * edit distance of a known word. Exact vocabulary words pass through
 * untouched; ordinary chat prose is left alone because most of it sits far
 * outside the allowlist (edit-distance gate). Adjacent-token merging
 * ("net flix" → netflix) runs as a first pass, single-token repair second.
 *
 * @internal exported for tests.
 */
export const snapToVocabulary = (text: string, vocabulary: string[]): string => {
  if (!text.trim() || !vocabulary.length) return text;

  const known = vocabulary
    .filter((w) => w && !w.includes(' '))
    .map((w) => w.toLowerCase());
  const knownSet = new Set(known);
  // Two edits is the ceiling: enough for real mishearings
  // ("calculater" → calculator is 1), loose enough to leave prose alone.
  const maxDist = 2;

  const tokens = text.split(/\s+/);
  let dirty = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i];
    const bare = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!bare || knownSet.has(bare) || SNAP_PROTECTED.has(bare)) continue;

    // First: could joining this token with the next one form a known word?
    // ("net flix" → netflix, "you tube" → youtube)
    const next = tokens[i + 1];
    if (next !== undefined) {
      const merged = `${bare}${next.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      if (knownSet.has(merged)) {
        tokens[i] = merged;
        tokens.splice(i + 1, 1);
        dirty = true;
        continue;
      }
    }

    // Otherwise: nearest known word within the edit-distance budget.
    if (bare.length < 4) continue;
    let best: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const word of known) {
      if (Math.abs(word.length - bare.length) > maxDist) continue;
      const dist = editDistance(bare, word);
      if (dist >= 1 && dist <= maxDist && dist < bestDist) {
        best = word;
        bestDist = dist;
      }
    }
    if (best) {
      tokens[i] = best;
      dirty = true;
    }
  }

  return dirty ? tokens.join(' ') : text;
};

/**
 * Parse the JSON sidecar written by the PowerShell script. Falls back to the
 * legacy plain-text format ("ERROR:..." or raw transcript) for robustness.
 */
const parseSidecar = (raw: string): { candidates: SttCandidate[]; error?: string } => {
  const trimmed = raw.trim();
  if (!trimmed) return { candidates: [] };
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: string;
      candidates?: SttCandidate[] | SttCandidate;
    };
    if (parsed.error) {
      return { candidates: [], error: parsed.error };
    }
    const list = Array.isArray(parsed.candidates)
      ? parsed.candidates
      : parsed.candidates
        ? [parsed.candidates]
        : [];
    const candidates = list
      .filter((c) => c && typeof c.text === 'string')
      .map((c) => ({
        text: String(c.text),
        grammar: typeof c.grammar === 'string' ? c.grammar : '',
        confidence: typeof c.confidence === 'number' ? c.confidence : 0,
      }));
    return { candidates };
  } catch {
    // Legacy plain-text sidecar.
    if (trimmed.startsWith('ERROR:')) {
      return {
        candidates: [],
        error: trimmed.slice('ERROR:'.length).trim() || 'Speech recognition failed.',
      };
    }
    return { candidates: [{ text: trimmed, grammar: '', confidence: 0 }] };
  }
};

/**
 * Transcribe with the vendored Whisper engine. Static vocabulary biasing is
 * applied through `--prompt`; the transcript is returned verbatim (Whisper's
 * output is already accurate, so the aggressive snap pass is deliberately NOT
 * applied here — it could rewrite legitimate words such as "email" → "gmail").
 * Rejects with `whisper-engine-missing` / `whisper-model-missing` when the
 * vendored files are absent so the caller can fall back.
 */
const transcribeWithWhisper = (wav: Buffer, vocabulary: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const dir = resolveWhisperDir();
    if (!dir) {
      reject(new Error('whisper-engine-missing'));
      return;
    }
    const model = resolveWhisperModel(dir);
    if (!model) {
      reject(new Error('whisper-model-missing'));
      return;
    }

    const id = randomUUID();
    const wavPath = path.join(os.tmpdir(), `ultron-stt-${id}.wav`);
    const threads = Math.max(2, Math.min(8, os.cpus().length));
    const args = [
      '-m', model,
      '-f', wavPath,
      '-l', 'en',
      '-nt', // no timestamps
      '-np', // results only — suppress the backend banner and timing noise
      '-t', String(threads),
      '-bs', '5', // beam search: more accurate than greedy decoding
      '-bo', '5',
      '--suppress-nst', // drop non-speech tokens such as "[static]"
      '--no-gpu',
    ];
    const prompt = buildWhisperPrompt(vocabulary);
    if (prompt) {
      args.push('--prompt', prompt);
    }

    (async () => {
      await fs.writeFile(wavPath, wav);
      const text = await new Promise<string>((resolveRun, rejectRun) => {
        execFile(
          path.join(dir, WHISPER_EXE),
          args,
          { windowsHide: true, timeout: WHISPER_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
          (error, stdout) => {
            if (error && (error as { killed?: boolean }).killed) {
              rejectRun(new Error('Transcription timed out.'));
              return;
            }
            const out = parseWhisperOutput(typeof stdout === 'string' ? stdout : '');
            if (error && !out) {
              rejectRun(new Error(`Whisper failed: ${error.message}`));
              return;
            }
            resolveRun(isSilenceHallucination(out) ? '' : out);
          },
        );
      });
      resolve(text);
    })()
      .catch(reject)
      .finally(() => {
        void fs.unlink(wavPath).catch(() => undefined);
      });
  });

/**
 * Windows System.Speech fallback (the original PowerShell path). Returns the
 * best-ranked recognised text (vocabulary-corrected), or an empty string when
 * nothing was heard. Throws with a human-readable message when the Windows
 * speech stack is unavailable.
 */
const transcribeWithWindowsSpeech = (wav: Buffer, vocabulary: string[] = []): Promise<string> =>
  new Promise((resolve, reject) => {

    const id = randomUUID();
    const wavPath = path.join(os.tmpdir(), `ultron-stt-${id}.wav`);
    const outPath = path.join(os.tmpdir(), `ultron-stt-${id}.json`);

    const cleanup = async () => {
      await Promise.allSettled([fs.unlink(wavPath), fs.unlink(outPath)]);
    };

    (async () => {
      await fs.writeFile(wavPath, wav);
      const script = buildScript(wavPath, outPath, vocabulary);
      await new Promise<void>((resolveRun, rejectRun) => {
        execFile(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
          { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 },
          (error) => {
            // A non-zero exit is expected when the script wrote an error
            // sidecar; the sidecar file is the source of truth either way.
            if (error && error.killed) {
              rejectRun(new Error('Transcription timed out.'));
              return;
            }
            resolveRun();
          },
        );
      });

      let raw = '';
      try {
        raw = await fs.readFile(outPath, 'utf8');
      } catch {
        throw new Error('Windows speech recognition produced no output.');
      }

      const { candidates, error } = parseSidecar(raw);
      if (error) {
        throw new Error(error || 'Speech recognition failed.');
      }
      return pickBestCandidate(candidates, vocabulary);
    })()
      .then(resolve, reject)
      .finally(cleanup);
  });
/**
 * Transcribe a PCM WAV buffer offline (16 kHz mono expected).
 *
 * Whisper is tried first; if the vendored engine/model is absent — or it fails
 * outright — the Windows System.Speech recogniser is used instead so voice
 * input keeps working on machines without the vendored files. `vocabulary` is a
 * SOFT hint only (Whisper `--prompt` bias / SAPI command grammar): it can never
 * authorise an action, only improve hearing.
 *
 * Returns the transcript, or an empty string when nothing was heard. Rejects
 * only when no engine could produce output at all.
 *
 * Engine selection via `ULTRON_STT_ENGINE`: `auto` (default) prefers Whisper
 * and falls back to Windows speech, `whisper` forces Whisper only, and
 * `windows` forces the legacy recogniser.
 */
export const transcribeWavBuffer = async (
  wav: Buffer,
  vocabulary: string[] = [],
): Promise<string> => {
  if (process.platform !== 'win32') {
    throw new Error('Offline transcription is only supported on Windows.');
  }
  assertWav(wav);

  const engine = (process.env.ULTRON_STT_ENGINE || 'auto').toLowerCase();
  if (engine === 'windows' || engine === 'sapi') {
    return transcribeWithWindowsSpeech(wav, vocabulary);
  }

  try {
    return await transcribeWithWhisper(wav, vocabulary);
  } catch (error) {
    if (engine === 'whisper') {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const engineMissing =
      message === 'whisper-engine-missing' || message === 'whisper-model-missing';
    if (!engineMissing) {
      console.warn(`[stt] Whisper unavailable (${message}); using Windows speech.`);
    }
    return transcribeWithWindowsSpeech(wav, vocabulary);
  }
};
