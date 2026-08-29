# ==========================================================
# ai-dev-team orchestrator image
#
# Task DB (PostgreSQL), dispatch queue (Redis), agent registry,
# and the HTTP API consumed by the DSH agent runners.
# Runs migrations automatically on boot.
# ==========================================================
FROM node:24-bookworm AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# pnpm-workspace.yaml carries the build-script allowlist (esbuild);
# without it pnpm 11 fails with ERR_PNPM_IGNORED_BUILDS.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# ----------------------------------------------------------
FROM node:24-bookworm

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node migrations ./migrations

USER node

EXPOSE 8000

# Migrate, then serve. Idempotent: migrations track applied versions.
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
