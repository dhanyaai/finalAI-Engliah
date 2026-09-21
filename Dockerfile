# ── Stage 1: build the Vite frontend ──────────────────────────────────────────
FROM node:22.22-alpine AS builder

WORKDIR /app
ENV npm_config_cache=/tmp/npm-cache

# Install deps first (layer-cached unless package.json changes)
COPY package*.json ./
# postinstall tries to rebuild Electron native modules — skip it in Docker
RUN npm ci --ignore-scripts --no-audit --no-fund

# Copy source and build
COPY . .
RUN npm run build:web

# ── Stage 2: production runtime ───────────────────────────────────────────────
FROM node:22.22-alpine AS runtime

WORKDIR /app
ENV npm_config_cache=/tmp/npm-cache

# Only the packages needed to run the Express server
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Copy the compiled frontend and the server source
COPY --from=builder /app/src/renderer/dist ./src/renderer/dist
COPY server ./server
COPY src/shared ./src/shared

ENV NODE_ENV=production

# DigitalOcean App Platform sets PORT at runtime; default 8080 for other hosts
EXPOSE 8080

# tsx runs TypeScript directly — no separate compile step needed
CMD ["npx", "tsx", "server/index.ts"]
