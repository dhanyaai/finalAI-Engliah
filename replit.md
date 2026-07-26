# HiKid

> AI English conversation companion for kids — Electron desktop app (macOS).

## Project overview

HiKid is an **Electron + React + TypeScript** desktop application. Kids speak into the microphone and a fully local AI pipeline (SoX → ASR → LLM → TTS) responds in English. All data stays on-device.

**Stack:** Electron 39, React 19, TypeScript, Vite (via electron-vite), Ollama (LLM), kitten-tts-server (TTS), Qwen3-ASR-0.6B (ASR).

## Running on Replit (web preview)

Because Replit is Linux-based and Electron requires a macOS display + native audio tooling, the full desktop app cannot run here. Instead, the **renderer (React UI) is served as a standalone web app** via Vite:

```
npm run dev:web
```

This starts a Vite dev server on port 5000. All `window.api` calls (Electron IPC) are stubbed with safe no-ops — the UI renders but audio/AI features are inactive.

## Running the real app (macOS only)

1. Install system dependencies: `brew install sox espeak-ng`
2. Install Ollama and run `ollama run qwen3:0.6b`
3. `npm install`
4. `npm run dev`  — starts Electron with hot-reload

See [INSTALL.md](INSTALL.md) for model/binary download instructions.

## Key scripts

| Command | Description |
|---|---|
| `npm run dev` | Electron dev mode (macOS only) |
| `npm run dev:web` | Web preview via Vite (Replit) |
| `npm run build:mac` | Package macOS .app |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests |

## Project structure

```
src/
├── main/       Electron main process (services, IPC, audio pipeline)
├── preload/    Preload script — exposes window.api to renderer
└── renderer/   React UI (the part visible in the Replit web preview)
src/shared/     Shared types and i18n
```

## User preferences

- Keep existing project structure and stack; do not restructure or migrate.
