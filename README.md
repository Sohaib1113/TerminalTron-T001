# TerminalTron (Ultron)

TerminalTron is an Electron desktop AI assistant for Windows. It has a Fastify backend, a React renderer, a SQLite database via Prisma, and LangChain talking to a local Ollama model by default.

> This is the single, global README for the repository. There is no separate README inside `ultron/`.

## Repository layout

```
TerminalTron-T001/
├── README.md          # this file (global README)
├── .gitignore         # global ignore rules
├── package.json       # root-level dependencies
└── ultron/            # the Electron app
    ├── src/
    │   ├── main/      # Electron main, preload, menu
    │   ├── backend/   # Fastify API, routes and services
    │   ├── renderer/  # React UI
    │   └── shared/    # constants and types
    ├── prisma/        # schema, migrations, local database
    ├── assets/        # icons
    ├── vendor/        # speech-to-text binaries (NOT committed, see below)
    └── .env.example   # environment template
```

## Prerequisites

- Node.js 18 or newer and npm

**AI runs fully offline, no install required.** TerminalTron bundles its own Ollama
runtime and the `mistral` model, so end users need nothing extra. On startup the app
reuses a local Ollama if one is already running, otherwise it launches the bundled
`vendor/ollama/ollama.exe` with a private model store. No internet connection is needed
at runtime.

## Setup

All commands run from `ultron/`.

```bash
cd ultron
npm install
npx prisma generate
npm run ollama:prepare   # one-time, on the build machine only (see below)
```

## Bundled offline AI (Ollama + model)

`vendor/ollama/` holds everything needed for offline chat. Like `vendor/whisper/`, the
whole `vendor/` tree is **git-ignored** (too large for the repo), so it is **not** committed
and travels with the installer instead:

- `ollama.exe` — a self-contained Ollama runtime (~26 MB).
- `lib/ollama/` — the CPU inference libraries, including `llama-server.exe`, that
  `ollama.exe` spawns to actually run a model (~40 MB). **Without these, the server starts
  and lists models but every generation fails.**
- `models/` — the model store for `mistral` (~4 GB).

Seed it once on a machine that already has the model, so it can be bundled for
distribution:

```bash
npm run ollama:prepare
```

That copies `ollama.exe` and your `~/.ollama/models` store into `vendor/ollama/`. To pull
a different model, run `ollama pull <name>` first (or point `$env:ULTRON_OLLAMA_MODELS_SRC`
at an existing model folder). Check what the app resolved at runtime via
`GET /api/health/ollama`, which reports whether it reused an existing Ollama, started the
bundled one, and whether the model store is present.

Create your environment file from the template:

```bash
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
```

## Speech-to-text binaries

`vendor/whisper/` holds the local speech-to-text binaries. It is about 161 MB, so it is **not** committed to git. You need it on disk for voice input to work. Copy it from your backup or local download.

Without it the app still boots, but voice transcription will not work.

## Configuration (`ultron/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `file:./ultron.db` | SQLite database location |
| `BACKEND_PORT` | `5000` | Backend server port |
| `NODE_ENV` | `development` | Runtime mode |
| `LLM_PROVIDER` | `ollama` | LLM backend to use |
| `LLM_MODEL` | `mistral` | Model name |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `HUGGINGFACE_API_KEY` | empty | Keys for hosted providers |
| `JWT_SECRET` | placeholder | Change before any real deployment |
| `ENABLE_MONITORING` / `MONITORING_INTERVAL` | `true` / `5000` | System monitoring toggle and interval (ms) |
| `LOG_LEVEL` / `LOG_FILE` | `debug` / `./logs/ultron.log` | Logging |

`.env` holds secrets and is git-ignored. Only `.env.example` is committed.

## Running

```bash
cd ultron
npm run dev
```

This starts, via `concurrently`:

| Process | Port / role |
| --- | --- |
| `dev:renderer` | Vite dev server on http://localhost:5173 |
| `dev:backend` | Fastify API on http://localhost:5000 |
| `dev:main` | TypeScript compile of the Electron main process |
| `dev:electron` | Electron window, launched after port 5173 is ready |

The UI has Dashboard, Tasks, Chat, Automation and Settings views.

Other useful scripts:

```bash
npm run build          # build renderer + main into dist/
npm start              # run the built app with Electron
npm run prisma:studio  # browse the database
```

## Git workflow

- `main` is the stable branch.
- Do feature work on a separate branch and open a pull request.

## License

See `ultron/LICENSE`.
