# API image with an optional sqlite-web sidecar (see scripts/start.sh).
# Build context is the repo root: docker build -f server/Dockerfile .
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/sqlite-web \
  && /opt/sqlite-web/bin/pip install --no-cache-dir sqlite-web==0.8.2

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY mcp/package.json mcp/
RUN npm ci -w shared -w server --include-workspace-root

COPY shared shared
COPY server server
RUN npm run build:server && chmod +x server/scripts/start.sh

WORKDIR /app/server
ENV NODE_ENV=production
CMD ["./scripts/start.sh"]
