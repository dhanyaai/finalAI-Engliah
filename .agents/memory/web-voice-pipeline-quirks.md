---
name: Web voice pipeline quirks (SpeechRecognition/SpeechSynthesis)
description: Non-obvious browser speech API failure modes in the web-mode voice flow and how the code guards against them.
---

## Rules
1. **TTS fires only on `sentence` SSE events.** Both chat backends must emit `sentence` (via `extractSentences`) alongside `delta` — dropping `sentence` silently kills voice output while text still streams.
2. **Chrome kills a SpeechRecognition session that starts while the previous session or speechSynthesis is winding down.** It fires `onerror` with `'aborted'` and the mic looks alive but hears nothing. Guard: dispose the old instance (detach handlers + `abort()`) before starting a new one, wrap `start()` in try/catch, and retry once (~150ms) while the press-and-hold gesture is still active.
3. **Never ignore `'aborted'` silently** — that was the "second time I speak it's not listening" bug: UI stuck on "Listening…" with a dead engine.
4. **A short press may end with only an interim transcript.** Accumulate final segments plus the latest interim segment, and submit the interim text as a fallback when no final result arrives. Otherwise the UI can show words while sending nothing to the AI.
5. **TTS cancellation must be generation-safe.** `speechSynthesis.cancel()` can trigger late callbacks from stale utterances; ignore callbacks from older generations so they cannot corrupt the active queue or emit a false idle state.

**Why:** Users reported voice working on first message but dead on the second; root cause was the TTS→mic handoff race (mic pressed right after Kitten spoke).

**How to apply:** Any change to `src/renderer/src/api-web.ts` recognition/TTS code must preserve: disposal before restart, one retry per gesture, interim fallback, cumulative results, one draft transcript bubble, and generation-safe chat/TTS cancellation. Run the mocked voice regression tests before browser smoke-testing.
