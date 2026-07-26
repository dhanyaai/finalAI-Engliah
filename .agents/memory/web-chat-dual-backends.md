---
name: Web chat has two backends (dev vs prod)
description: The /api/chat endpoint is served by different code in dev and production — changes must go to both.
---

## Rule
Any change to the web chat API (`/api/chat` request/response contract, SSE event types, filtering rules) must be applied in **two places**:
- `src/web/chat-plugin.ts` — Vite dev-server plugin; handles `/api/chat` **in development** (intercepts before the proxy)
- `server/index.ts` — Express; handles `/api/chat` **in production** (DigitalOcean/Docker, where no Vite dev server exists)

**Why:** The client (`api-web.ts`) sends `{ messages: [{role, text}...] }` (stateless full history). The Express server originally only accepted `{ message: string }` — this mismatch was invisible in the Replit preview (plugin handled it) but broke every chat on the deployed app with "Invalid value for 'content': expected a string, got null" because `req.body.message` was undefined. Fixed 2026-07-26 by making Express accept both contracts.

**How to apply:** When touching chat behavior, grep both files for the SSE event names (`delta`, `sentence`, `done`, `interrupted`, `error`). The client triggers TTS only on `sentence` events — dropping them silently kills voice output. Test production behavior with `curl -d '{"messages":[...]}'` against the Express port (3000), not just the Vite port (5000).

## Deploy pipeline gotcha
DigitalOcean redeploys pull `latest` from the container registry. If `docker push` fails or is skipped, triggering a deployment silently re-ships the OLD image and "the fix didn't work". Always verify push exit code + new digest before `create-deployment`, and verify the fix on the live URL afterward.
