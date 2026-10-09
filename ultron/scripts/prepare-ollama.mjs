/**
 * Seeds the bundled, offline Ollama runtime so the app needs no internet and no
 * user-side Ollama install.
 *
 * Run:  npm run ollama:prepare
 *
 * It copies, into ultron/vendor/ollama/:
 *   - ollama.exe  (from an existing Ollama install, or $ULTRON_OLLAMA_SRC)
 *   - models/     (the local model store: manifests + blobs, from ~/.ollama/models
 *                  or $ULTRON_OLLAMA_MODELS_SRC)
 *
 * The models payload is large (~4 GB for mistral) and is intentionally git-ignored;
 * it travels with the installer. This script only needs to run once per build machine.
 *
 * Usage examples:
 *   npm run ollama:prepare
 *   $env:ULTRON_OLLAMA_MODELS_SRC='D:\models'; npm run ollama:prepare
 */
import { existsSync, mkdirSync, cpSync, readdirSync, statSync, copyFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const repoVendor = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'ollama');

const findOllamaExe = () => {
  const candidates = [];
  if (process.env.ULTRON_OLLAMA_SRC) {
    candidates.push(
      process.env.ULTRON_OLLAMA_SRC.endsWith('.exe')
        ? process.env.ULTRON_OLLAMA_SRC
        : path.join(process.env.ULTRON_OLLAMA_SRC, 'ollama.exe'),
    );
  }
  candidates.push(path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'));
  candidates.push(path.join('C:\\Program Files', 'Ollama', 'ollama.exe'));
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return null;
};

const findModelStore = () => {
  if (process.env.ULTRON_OLLAMA_MODELS_SRC && existsSync(process.env.ULTRON_OLLAMA_MODELS_SRC)) {
    return process.env.ULTRON_OLLAMA_MODELS_SRC;
  }
  const home = path.join(os.homedir(), '.ollama', 'models');
  return existsSync(home) ? home : null;
};

mkdirSync(repoVendor, { recursive: true });

const exe = findOllamaExe();
if (!exe) {
  console.error(
    '[ollama:prepare] Could not find ollama.exe. Install Ollama, or set $env:ULTRON_OLLAMA_SRC to the folder containing it.',
  );
  process.exit(1);
}
cpSync(exe, path.join(repoVendor, 'ollama.exe'));
console.log(`[ollama:prepare] Copied ollama.exe  <- ${exe}`);

// ollama.exe spawns llama-server.exe (from lib/ollama/) at generation time, so the
// CPU inference libraries MUST ship alongside the binary. We copy only the top-level
// files of lib/ollama/ (llama-server.exe + the ggml-cpu-*.dll / libllama*.dll set,
// ~40 MB) and skip the multi-GB GPU backends (cuda_*, rocm_*, vulkan) since the app
// targets CPU inference. Add those subfolders here if you later need GPU offload.
const ollamaInstallDir = path.dirname(exe);
const srcLib = path.join(ollamaInstallDir, 'lib', 'ollama');
if (existsSync(srcLib)) {
  const destLib = path.join(repoVendor, 'lib', 'ollama');
  mkdirSync(destLib, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(srcLib)) {
    const from = path.join(srcLib, entry);
    // Copy files only; skip GPU backend subfolders to keep the bundle lean.
    if (statSync(from).isFile()) {
      copyFileSync(from, path.join(destLib, entry));
      copied += 1;
    }
  }
  console.log(
    `[ollama:prepare] Copied ${copied} CPU inference libs (incl. llama-server.exe) <- ${srcLib} (GPU backends skipped)`,
  );
} else {
  console.warn(
    `[ollama:prepare] No lib/ollama folder next to ollama.exe (${srcLib}). Generation will fail: llama-server.exe is missing.`,
  );
}

const store = findModelStore();
if (!store) {
  console.warn(
    '[ollama:prepare] No model store found. Expected ~/.ollama/models (run `ollama pull mistral` first) or set $env:ULTRON_OLLAMA_MODELS_SRC. Skipping model copy.',
  );
  process.exit(0);
}
const dest = path.join(repoVendor, 'models');
cpSync(store, dest, { recursive: true });
console.log(`[ollama:prepare] Copied model store <- ${store}`);
console.log('[ollama:prepare] Done. The app will now run fully offline with the bundled model.');
