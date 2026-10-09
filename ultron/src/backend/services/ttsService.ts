import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

/**
 * XTTS-v2 cinematic voice runtime — offline text-to-speech cloned from a
 * reference clip (vendor/tts/voices/ultron-reference.mp3).
 *
 * Unlike Ollama (a standalone binary), XTTS-v2 is a Python package, so this
 * service runs a small vendored Python server (`vendor/tts/xtts_server.py`)
 * inside a dedicated venv (`vendor/tts/.venv`). It is a persistent process:
 * the ~1.8 GB model loads once, then each reply synthesizes quickly.
 *
 * Startup mirrors ollamaRuntime: reuse an already-running server on the port if
 * present, otherwise spawn the venv's python. Falls back gracefully — when the
 * runtime is unavailable the caller (voice.ts) keeps using the Web Speech API.
 *
 * Setup (once, on a machine with the reference clip):  npm run tts:prepare
 */

export interface TtsRuntimeStatus {
  port: number;
  baseUrl: string;
  ready: boolean;
  reused: boolean;
  referencePresent: boolean;
  device?: string;
  error?: string;
}

const DEFAULT_PORT = 5007;

/** Walk up / CWD / Electron resources to locate the vendored `tts` dir. */
const resolveTtsDir = (): string | null => {
  const override = process.env.ULTRON_TTS_DIR;
  if (override && existsSync(path.join(override, 'xtts_server.py'))) {
    return override;
  }
  const candidates: string[] = [];
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    candidates.push(path.join(dir, 'vendor', 'tts'));
    dir = path.dirname(dir);
  }
  candidates.push(path.join(process.cwd(), 'vendor', 'tts'));
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'vendor', 'tts'));
  }
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'xtts_server.py'))) {
      return candidate;
    }
  }
  return null;
};

const venvPython = (ttsDir: string): string | null => {
  const p = path.join(ttsDir, '.venv', 'Scripts', 'python.exe');
  return existsSync(p) ? p : null;
};

const healthUrl = (port: number) => `http://127.0.0.1:${port}/health`;

const probeHealth = async (port: number): Promise<TtsRuntimeStatus | null> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(healthUrl(port), { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as TtsRuntimeStatus;
  } catch {
    return null;
  }
};

const waitForReady = async (port: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probeHealth(port))?.ready) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};


export class TtsRuntime {
  private child: ChildProcess | null = null;
  private status: TtsRuntimeStatus;

  constructor() {
    this.status = {
      port: Number(process.env.ULTRON_TTS_PORT || DEFAULT_PORT),
      baseUrl: `http://127.0.0.1:${Number(process.env.ULTRON_TTS_PORT || DEFAULT_PORT)}`,
      ready: false,
      reused: false,
      referencePresent: false,
    };
  }

  /**
   * Ensure the XTTS server is reachable and its model is loaded. Reuses an
   * existing server if present; otherwise spawns the vendored venv. Safe to
   * call repeatedly; only the first call may block while the model loads.
   */
  async ensureRunning(): Promise<TtsRuntimeStatus> {
    const { port } = this.status;
    const ttsDir = resolveTtsDir();
    this.status.referencePresent = ttsDir
      ? existsSync(path.join(ttsDir, 'voices', 'ultron-reference.mp3'))
      : false;

    const existing = await probeHealth(port);
    if (existing?.ready) {
      this.status = { ...this.status, ...existing, reused: true, ready: true };
      return this.status;
    }

    if (!ttsDir) {
      this.status.error = 'Vendored XTTS server not found (vendor/tts/xtts_server.py).';
      return this.status;
    }
    const python = venvPython(ttsDir);
    if (!python) {
      this.status.error =
        'XTTS venv missing (vendor/tts/.venv). Run `npm run tts:prepare` to install it.';
      return this.status;
    }

    const env: NodeJS.ProcessEnv = { ...process.env, ULTRON_TTS_PORT: String(port) };
    this.child = spawn(python, [path.join(ttsDir, 'xtts_server.py')], {
      cwd: ttsDir,
      env,
      windowsHide: true,
      stdio: 'ignore',
      detached: false,
    });
    this.child.on('error', (err) => {
      this.status.error = err.message;
    });
    this.child.unref();

    this.status.ready = await waitForReady(port, 180000); // model load can be slow
    if (!this.status.ready) {
      this.status.error =
        `XTTS model did not become ready on port ${port} within 180s (first load downloads/loads ~1.8GB).`;
    }
    const fresh = await probeHealth(port);
    if (fresh) {
      this.status.device = fresh.device;
    }
    return this.status;
  }

  getStatus(): TtsRuntimeStatus {
    return this.status;
  }

  /**
   * Synthesize `text` into WAV bytes using the cloned voice. Returns null when
   * the runtime is unavailable so the caller can fall back to Web Speech.
   * `speed` defaults to 1.0 — the natural reference voice. Raise it only if you
   * explicitly want faster-than-natural speech (it changes the timbre).
   */
  async synthesize(text: string, speed = 1.0): Promise<Buffer | null> {
    if (!text.trim()) {
      return null;
    }
    const status = this.status.ready ? this.status : await this.ensureRunning();
    if (!status.ready) {
      return null;
    }
    try {
      const res = await fetch(`${this.status.baseUrl}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speed }),
      });
      if (!res.ok) {
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }

  /** Sample rate of the streamed PCM (matches the XTTS server output). */
  get sampleRate(): number {
    return 24000;
  }

  /**
   * Start a streaming synthesis. Returns the raw fetch Response whose body is a
   * stream of 16-bit little-endian PCM chunks (24kHz mono), or null when the
   * runtime is unavailable. The caller pipes this straight back to the browser
   * so playback can begin on the first chunk instead of after the whole reply.
   */
  async startStream(text: string, speed = 1.0): Promise<Response | null> {
    if (!text.trim()) {
      return null;
    }
    const status = this.status.ready ? this.status : await this.ensureRunning();
    if (!status.ready) {
      return null;
    }
    try {
      const res = await fetch(`${this.status.baseUrl}/tts/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, speed }),
      });
      return res.ok ? res : null;
    } catch {
      return null;
    }
  }


  stop(): void {
    if (this.child && !this.child.killed) {
      try {
        spawnSync('taskkill', ['/pid', String(this.child.pid), '/t', '/f'], { windowsHide: true });
      } catch {
        /* best effort */
      }
      this.child = null;
    }
    this.status.ready = false;
  }
}

export const ttsRuntime = new TtsRuntime();
