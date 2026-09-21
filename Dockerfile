# ── Stage 1: build the Vite frontend ──────────────────────────────────────────
FROM node:22.22-alpine AS builder

WORKDIR /app
ENV npm_config_cache=/tmp/npm-cache

# The production web app does not need Electron, model tooling, desktop
# packagers, or test dependencies. Keeping a small deployment manifest avoids
# exhausting App Platform's build worker while installing irrelevant packages.
COPY deploy/package.json ./package.json
RUN npm install --ignore-scripts --no-audit --no-fund --package-lock=false

# Copy source and build
COPY . .
RUN npm run build:web
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM node:22.22-alpine AS runtime

WORKDIR /app
ENV npm_config_cache=/tmp/npm-cache

# Reuse the pruned web dependencies from the builder instead of running a
# second package installation.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

# Copy the compiled frontend and the server source
COPY --from=builder /app/src/renderer/dist ./src/renderer/dist
COPY server ./server
COPY src/shared ./src/shared

ENV NODE_ENV=production

# DigitalOcean App Platform sets PORT at runtime; default 8080 for other hosts
EXPOSE 8080

# tsx runs TypeScript directly — no separate compile step needed
CMD ["npx", "tsx", "server/index.ts"]
