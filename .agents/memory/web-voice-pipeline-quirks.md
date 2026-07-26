---
name: Web voice pipeline quirks (SpeechRecognition/SpeechSynthesis)
description: Non-obvious browser speech API failure modes in the web-mode voice flow and how the code guards against them.
---

## Rules
1. **TTS fires only on `sentence` SSE events.** Both chat backends must emit `sentence` (via `extractSentences`) alongside `delta` — dropping `sentence` silently kills voice output while text still streams.
2. **Chrome kills a SpeechRecognition session that starts while the previous session or speechSynthesis is winding down.** It fires `onerror` with `'aborted'` and the mic looks alive but hears nothing. Guard: dispose the old instance (detach handlers + `abort()`) before starting a new one, wrap `start()` in try/catch, and retry once (~150ms) while the press-and-hold gesture is still active.
3. **Never ignore `'aborted'` silently** — that was the "second time I speak it's not listening" bug: UI stuck on "Listening…" with a dead engine.

**Why:** Users reported voice working on first message but dead on the second; root cause was the TTS→mic handoff race (mic pressed right after Kitten spoke).

**How to apply:** Any change to `src/renderer/src/api-web.ts` recognition/TTS code must preserve: disposal before restart, the one-retry-per-gesture logic, and the `gestureActive` flag semantics (set on press, cleared on release; a late `onstart` stops the engine if the button was already released).
