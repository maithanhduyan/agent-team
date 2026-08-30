# ==========================================================
# demo-project backend service image
#
# Standalone HTTP API skeleton (Fastify + TypeScript). Not yet
# wired into the compose stack; run with:
#   docker build -t ai-team/backend:local backend/
#   docker run --rm -p 4000:4000 ai-team/backend:local
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

USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]
