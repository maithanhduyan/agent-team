# Backend service

`demo-project` backend service skeleton — a standalone HTTP API built with
**Node.js 20+**, **TypeScript** (strict) and **Fastify 5**, mirroring the
conventions of the `orchestrator/` package in this repository (pnpm,
NodeNext ESM, `dist/` build output, multi-stage Dockerfile).

## Endpoints

| Method | Path      | Response                          |
|--------|-----------|-----------------------------------|
| GET    | `/healthz`| `200` `{"ok": true}`              |
| GET    | `/`       | service metadata + `/healthz` link |

`/healthz` is a pure liveness probe: it has no database or external
dependencies, so it answers as soon as the process is up. It returns
exactly the JSON body `{"ok": true}`.

## Configuration

Environment variables (all optional):

| Variable      | Default | Description                    |
|---------------|---------|--------------------------------|
| `BACKEND_PORT`| `4000`  | Port to listen on              |
| `PORT`        | —       | Fallback if `BACKEND_PORT` unset |
| `HOST`        | `0.0.0.0` | Interface to bind            |
| `LOG_LEVEL`   | `info`  | pino log level (e.g. `silent`) |

## Development

```bash
pnpm install     # first time
pnpm dev         # tsx watch (hot reload)
pnpm typecheck   # tsc --noEmit (src + test)
pnpm test        # unit tests (node:test + Fastify inject)
pnpm smoke       # real-HTTP smoke test against the compiled server
pnpm check       # typecheck + test + smoke
```

- **Unit tests** (`test/healthz.test.ts`) use the built-in `node:test`
  runner with Fastify's `inject()` — no port binding, fast and
  deterministic.
- **Smoke test** (`scripts/smoke.mjs`) boots the compiled server
  (`dist/server.js`) on an ephemeral port, performs a real `GET /healthz`
  over HTTP, asserts `200` + `{"ok": true}` + `application/json`, then
  verifies graceful shutdown on `SIGTERM`. It is the acceptance proof for
  the `/healthz` contract.

## Run

```bash
pnpm build
pnpm start                 # listens on 0.0.0.0:4000 (or BACKEND_PORT)
curl http://localhost:4000/healthz   # -> {"ok":true}
```

## Container

```bash
docker build -t ai-team/backend:local backend/
docker run --rm -p 4000:4000 ai-team/backend:local
```

The image is **not** wired into `compose.yaml` yet — see
`DECISIONS.md` (ADR-001) for the reasoning and next steps.
