/**
 * Provisions the bundled, offline XTTS-v2 cinematic voice.
 *
 * Run:  npm run tts:prepare
 *
 * Creates a dedicated Python 3.11 virtualenv under ultron/vendor/tts/.venv and
 * installs Coqui TTS (which provides the XTTS-v2 model, ~1.8 GB downloaded on
 * first synthesis). XTTS-v2 REQUIRES Python 3.9-3.11 — it will NOT install under
 * 3.12 — so this script looks for a 3.11 interpreter and tells you how to get
 * one if it's missing.
 *
 * The reference voice clip (vendor/tts/voices/ultron-reference.mp3) is what the
 * model clones. Replace that file to change Ultron's voice; no code changes
 * needed. Keep it ~6+ seconds of clean speech.
 *
 * Everything here is git-ignored (large); it ships with the installer.
 */
import { existsSync, mkdirSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import os from 'os';
import path from 'path';

const ttsDir = path.resolve(__dirname, '..', 'vendor', 'tts');
const venvDir = path.join(ttsDir, '.venv');
const venvPython = path.join(venvDir, 'Scripts', 'python.exe');
const reference = path.join(ttsDir, 'voices', 'ultron-reference.mp3');

mkdirSync(ttsDir, { recursive: true });

if (!existsSync(reference)) {
  console.error(
    `[tts:prepare] Missing reference voice: ${reference}\n` +
      '  Drop a 6+ second clean WAV/MP3 of the target voice there (rename to ultron-reference.mp3).',
  );
  process.exit(1);
}

// Find a Python 3.11 interpreter (XTTS-v2 does not support 3.12+).
const findPython311 = () => {
  for (const cmd of ['py -3.11', 'python3.11', 'python']) {
    const probe = spawnSync(cmd.split(' ')[0], [...cmd.split(' ').slice(1), '--version'], {
      encoding: 'utf8',
    });
    const out = `${probe.stdout || ''}${probe.stderr || ''}`;
    if (/3\.(9|10|11)/.test(out)) {
      return cmd;
    }
  }
  return null;
};

const py311 = findPython311();
if (!py311) {
  console.error(
    '[tts:prepare] No compatible Python (3.9-3.11) found. XTTS-v2 will not install on 3.12+.\n' +
      '  Install Python 3.11, e.g.:  winget install --id Python.Python.3.11 -e',
  );
  process.exit(1);
}

if (!existsSync(venvPython)) {
  console.log(`[tts:prepare] Creating venv with "${py311}"...`);
  const [exe, ...args] = py311.split(' ');
  execSync(`${exe} ${args.join(' ')} -m venv "${venvDir}"`, { stdio: 'inherit' });
}

console.log('[tts:prepare] Upgrading pip...');
execSync(`"${venvPython}" -m pip install --upgrade pip`, { stdio: 'inherit' });

console.log('[tts:prepare] Installing Coqui TTS (this pulls PyTorch, ~2.5 GB)...');
// Pin the exact versions XTTS-v2 needs on Windows:
//   - transformers 4.37.x  (4.4x+/5.x removed BeamSearchScorer)
//   - torch/torchaudio 2.5.x (2.6 changed torch.load to weights_only=True,
//     which breaks TTS checkpoint loading)
// TTS 0.22.0 must be installed first so pip doesn't yank a newer transformers.
execSync(`"${venvPython}" -m pip install TTS==0.22.0 "transformers==4.37.2"`, {
  stdio: 'inherit',
});

// Install a CUDA build of torch/torchaudio when an NVIDIA GPU is present — it
// makes XTTS synthesis ~10x faster (faster than realtime) with the same voice.
// Fall back to the plain CPU wheels otherwise. We install torch explicitly (not
// just letting TTS pull it) so the matching cu124 torchaudio is used too.
console.log('[tts:prepare] Installing PyTorch (CUDA if available, else CPU)...');
// Detect an NVIDIA GPU without importing torch (it may not be installed yet).
// Try nvidia-smi on PATH, then WMI's video controller, then nvml.dll.
const hasNvidiaGpu = () => {
  const probes = [
    'nvidia-smi -L',
    'powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match \'NVIDIA\' }).Count -gt 0"',
  ];
  for (const cmd of probes) {
    try {
      execSync(cmd, { stdio: 'ignore' });
      return true;
    } catch {
      /* try the next probe */
    }
  }
  return false;
};

if (hasNvidiaGpu()) {
  console.log('[tts:prepare] NVIDIA GPU detected — installing cu124 torch/torchaudio.');
  execSync(
    `"${venvPython}" -m pip install "torch==2.5.1+cu124" "torchaudio==2.5.1+cu124" ` +
      `--index-url https://download.pytorch.org/whl/cu124`,
    { stdio: 'inherit' },
  );
} else {
  console.log('[tts:prepare] No NVIDIA GPU detected — installing CPU torch/torchaudio.');
  execSync(`"${venvPython}" -m pip install "torch==2.5.1" "torchaudio==2.5.1"`, {
    stdio: 'inherit',
  });
}

console.log('[tts:prepare] Done. The app will now speak in the cloned Ultron voice.');
console.log(`[tts:prepare] Reference clip: ${reference}`);
