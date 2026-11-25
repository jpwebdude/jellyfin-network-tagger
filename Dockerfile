# ─── Jellyfin Network Tagger ────────────────────────────────────────────────
# Web dashboard & service that tags your Jellyfin v10.8–v12.4+ library with
# streaming provider names and tags local Movie/TV folders with [tmdbid-ID].
#
# Build:  docker compose up -d --build
# Pull:   docker pull ghcr.io/jpwebdude/jellyfin-network-tagger:latest
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-slim

LABEL org.opencontainers.image.source="https://github.com/jpwebdude/jellyfin-network-tagger"
LABEL org.opencontainers.image.description="Web dashboard for automatic Jellyfin streaming provider tagging and local [tmdbid-ID] library tagging."
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"
LABEL org.opencontainers.image.authors="jpwebdude"

ENV NODE_ENV=production \
    PORT=3000 \
    CONFIG_FILE=/app/data/config.json

WORKDIR /app

# Install runtime dependencies
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy application code and web assets
COPY server.ts tsconfig.json ./
COPY src ./src
COPY public ./public
COPY docs ./docs

# Persistent configuration directory for non-root node user (UID/GID 1000)
RUN mkdir -p /app/data && chown -R node:node /app

EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

USER node

CMD ["./node_modules/.bin/tsx", "server.ts"]
