# HiKid

> AI English conversation companion for kids — web-enabled build running on Replit.

## Project overview

HiKid is an **Electron + React + TypeScript** desktop application, adapted to run fully in the browser on Replit. Kids speak into the microphone and an AI responds in English, with both text and spoken audio.

**Stack:** React 19, TypeScript, Vite, Express (web backend), OpenAI-compatible LLM API, browser SpeechRecognition (STT), browser SpeechSynthesis (TTS).

## Running on Replit

```
npm run dev:web
```

This starts two processes via `concurrently`:
- **Express backend** (`server/index.ts`) on port 3000 — handles LLM streaming chat and config
- **Vite dev server** (`vite.web.config.ts`) on port 5000 — serves the React UI, proxies `/api` to port 3000

The `OPENAI_API_KEY` secret is automatically detected. The backend defaults to `gpt-4o-mini` via `https://api.openai.com/v1`. Both can be overridden in the app's Settings panel or via environment variables:

| Env var | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | API key (auto-detected) | — |
| `LLM_BASE_URL` | Override base URL | `https://api.openai.com/v1` |
| `LLM_API_KEY` | Override API key | `OPENAI_API_KEY` value |
| `LLM_MODEL` | Override model name | `gpt-4o-mini` |

## How it works (web mode)

```
User speaks → browser SpeechRecognition (STT)
           → POST /api/chat (SSE stream)
           → Express backend → OpenAI-compatible LLM
           → sentence chunks streamed back
           → browser SpeechSynthesis (TTS) speaks each sentence
```

- **Voice input**: Hold the mic button and speak (Chrome/Edge required for SpeechRecognition)
- **Text chat**: Enable the text toggle (⊞) in the top-right to see the conversation transcript
- **Settings**: Click the gear icon to change AI name, system prompt, or LLM endpoint

## Running the original macOS desktop app

The native Electron app uses local models (no cloud API needed):

1. `brew install sox espeak-ng`
2. Install Ollama → `ollama run qwen3:0.6b`
3. `npm install && npm run dev`

See [INSTALL.md](INSTALL.md) for model/binary download instructions.

## Dependency security notes (July 2026)

- `npm audit fix` plus a `brace-expansion: ^5.0.8` override in `package.json` cleared the critical (node-tar) and all high vulnerabilities (31 → 3).
- **Remaining (3 moderate, accepted for now):** `@anthropic-ai/sdk` (GHSA-p7fg-763f-g4gf, insecure default file permissions in a local memory tool) pulled in via `@mariozechner/pi-ai` / `pi-agent-core`. Fixing requires a breaking upgrade to `pi-ai`/`pi-agent-core` `0.73.x`; low practical risk since the affected SDK tool isn't used here. Revisit when upgrading those packages.

## Key scripts

| Command | Description |
|---|---|
| `npm run dev:web` | Web mode — backend + Vite (Replit) |
| `npm run dev:server` | Backend only |
| `npm run dev` | Electron dev mode (macOS only) |
| `npm run build:mac` | Package macOS .app |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |

## Project structure

```
server/
└── index.ts        Express API backend (web mode only)
src/
├── main/           Electron main process (macOS desktop)
├── preload/        Preload script — exposes window.api to renderer
└── renderer/       React UI
    └── src/
        ├── api-web.ts   Web implementation of window.api (browser Speech APIs + fetch)
        └── api-stub.ts  No-op stub (kept for reference, not used)
src/shared/         Shared types and i18n
vite.web.config.ts  Standalone Vite config for web mode
```

## User preferences

- Keep existing project structure and stack; do not restructure or migrate.
