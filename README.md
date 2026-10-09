# TerminalTron (Ultron)

TerminalTron is an Electron desktop app (project folder: `ultron/`) with a Node.js backend, a React renderer, and a configurable LLM provider (Ollama by default; OpenAI, Anthropic and Hugging Face are supported through API keys).

> This is the single, global README for the repository. Do not add a separate README inside `ultron/`.

## Repository layout

```
TerminalTron-T001/
├── README.md        # this file (global README)
├── .gitignore       # global ignore rules
├── package.json     # root-level dependencies
└── ultron/          # Electron app (main + renderer, build scripts, config)
    ├── .erb/        # build / dev scripts and webpack configs
    ├── assets/      # icons and static assets
    ├── .env.example # environment template
    └── ...
```

## Prerequisites

- Node.js 18 or newer and npm
- (Optional) [Ollama](https://ollama.com/) running locally for the default LLM provider

## Setup

```bash
# from the repository root
npm install

# then the app
cd ultron
npm install
```

Create your environment file from the template:

```bash
cd ultron
copy .env.example .env      # Windows
# cp .env.example .env      # macOS / Linux
```

## Configuration (`ultron/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `file:./ultron.db` | Local database location |
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

Use the scripts defined in `ultron/package.json` (for example `npm start` or `npm run dev`) to launch the app in development.

## Git workflow

- `main` is the stable branch.
- Do feature work on a separate branch and open a pull request.

## License

See `ultron/LICENSE`.
