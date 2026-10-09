import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

/**
 * Bundled Ollama runtime manager — enables fully offline, zero-download AI.
 *
 * TerminalTron ships `ollama.exe` (self-contained, ~26 MB) under `vendor/ollama/`
 * and the `mistral` model weights under a local model store. On startup this
 * service:
 *   1. Reuses any Ollama already listening on the port (e.g. a dev machine's own
 *      install) when possible.
 *   2. Otherwise spawns the BUNDLED `ollama serve` with `OLLAMA_MODELS` pointed at
 *      a store inside the app so it needs no internet and no user-side install.
 *
 * The model store is seeded by `npm run ollama:prepare`, which copies the model
 * from a machine that already has it (~/.ollama/models) into the repo's
 * `vendor/ollama/models`. That payload is ~4 GB so it is intentionally NOT
 * committed to git (see `.gitignore`); it travels with the installer.
 *
 * OLLAMA_MODELS layout Ollama expects:
 *   <store>/manifests/registry.ollama.ai/library/<model>/latest
 *   <store>/blobs/sha256-<hash...>
 */

export interface OllamaRuntimeStatus {
  port: number;
  baseUrl: string;
  model: string;
  running: boolean;
  bundled: boolean;
  reused: boolean;
  modelPresent: boolean;
  error?: string;
}

const DEFAULT_PORT = 11434;
const DEFAULT_MODEL = 'mistral';

/** Walk up from this file, CWD and Electron resources to locate `vendor/ollama`. */
const resolveVendorDir = (): string | null => {
  const override = process.env.ULTRON_OLLAMA_DIR;
  if (override && existsSync(path.join(override, 'ollama.exe'))) {
    return override;
  }
  const candidates: string[] = [];
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    candidates.push(path.join(dir, 'vendor', 'ollama'));
    dir = path.dirname(dir);
  }
  candidates.push(path.join(process.cwd(), 'vendor', 'ollama'));
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'vendor', 'ollama'));
  }
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'ollama.exe'))) {
      return candidate;
    }
  }
  return null;
};

/** Locate the seeded model store — the vendored copy, else the user's own ~/.ollama/models. */
const resolveModelStore = (): string | null => {
  const vendorDir = resolveVendorDir();
  const vendored = vendorDir ? path.join(vendorDir, 'models') : null;
  if (vendored && existsSync(vendored)) {
    return vendored;
  }
  const homeStore = path.join(os.homedir(), '.ollama', 'models');
  if (existsSync(homeStore)) {
    return homeStore;
  }
  return null;
};

const isPortOpen = async (port: number): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
};

/** Wait until Ollama answers on the port, up to `timeoutMs`. */
const waitForReady = async (port: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
};

export class OllamaRuntime {
  private child: ChildProcess | null = null;
  private status: OllamaRuntimeStatus;

  constructor() {
    this.status = {
      port: Number(process.env.OLLAMA_PORT || DEFAULT_PORT),
      baseUrl: process.env.OLLAMA_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`,
      model: process.env.LLM_MODEL || DEFAULT_MODEL,
      running: false,
      bundled: false,
      reused: false,
      modelPresent: false,
    };
  }

  /**
   * Ensure an Ollama server is reachable. Reuses an existing one if present;
   * otherwise starts the bundled binary. Safe to call more than once.
   */
  async ensureRunning(): Promise<OllamaRuntimeStatus> {
    const { port } = this.status;
    this.status.modelPresent = resolveModelStore() !== null;

    if (await isPortOpen(port)) {
      this.status.running = true;
      this.status.reused = true;
      return this.status;
    }

    const vendorDir = resolveVendorDir();
    if (!vendorDir) {
      this.status.error =
        'No bundled Ollama binary found (vendor/ollama/ollama.exe) and no server on port ' +
        port +
        '. Run `npm run ollama:prepare`.';
      return this.status;
    }

    this.status.bundled = true;
    const exe = path.join(vendorDir, 'ollama.exe');
    const env: NodeJS.ProcessEnv = { ...process.env, OLLAMA_HOST: `127.0.0.1:${port}` };
    const store = resolveModelStore();
    if (store) {
      env.OLLAMA_MODELS = store;
    }

    this.child = spawn(exe, ['serve'], {
      env,
      windowsHide: true,
      stdio: 'ignore',
      detached: false,
    });
    this.child.on('error', (err) => {
      this.status.error = err.message;
    });
    this.child.unref();

    this.status.running = await waitForReady(port, 30000);
    if (!this.status.running) {
      this.status.error = `Bundled Ollama did not become ready on port ${port} within 30s.`;
    }
    return this.status;
  }

  getStatus(): OllamaRuntimeStatus {
    return this.status;
  }

  /** Stop the bundled server if we started it. */
  stop(): void {
    if (this.child && !this.child.killed) {
      try {
        spawnSync('taskkill', ['/pid', String(this.child.pid), '/t', '/f'], { windowsHide: true });
      } catch {
        /* best effort */
      }
      this.child = null;
    }
    this.status.running = false;
  }
}

export const ollamaRuntime = new OllamaRuntime();

/** Exposed for the `ollama:prepare` script: find the seeded store dir. */
export const getModelStorePath = (): string | null => resolveModelStore();
