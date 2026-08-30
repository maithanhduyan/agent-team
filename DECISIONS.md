# Decisions (ADR)

Architecture decisions are recorded here as short ADRs, in reverse
chronological order. Add a new entry whenever a public contract or the
project architecture changes.

## ADR-001 — Backend service skeleton: standalone Fastify package

- **Status:** accepted (TASK-174)
- **Date:** 2026-08
- **Context:** `demo-project` needs a backend service exposing a
  `/healthz` liveness endpoint (`{"ok": true}`) and a smoke test proving
  it works. The repository already runs a TypeScript/Fastify API (the
  orchestrator), so the new service should follow the same conventions
  rather than introduce a second stack.
- **Decision:**
  - New standalone package `backend/` (Node.js ≥ 20, TypeScript strict,
    Fastify 5, pnpm) — same layout as `orchestrator/` (`src/` → `dist/`,
    NodeNext ESM, `pnpm-workspace.yaml` esbuild allowlist, multi-stage
    Dockerfile).
  - `GET /healthz` is a **pure liveness probe**: no DB or external
    dependencies, returns exactly `{"ok": true}`. This intentionally
    differs from the orchestrator's `/healthz` (which performs a DB
    check) — the backend service is dependency-free by design.
  - Tests: unit tests via the built-in `node:test` runner with Fastify
    `inject()`; a real-HTTP smoke test (`scripts/smoke.mjs`) boots the
    compiled server on an ephemeral port, asserts `200` +
    `{"ok": true}` + `application/json`, and verifies graceful shutdown
    on `SIGTERM`.
  - Config via environment: `BACKEND_PORT` (falls back to `PORT`), `HOST`,
    `LOG_LEVEL`.
- **Consequences:**
  - The service runs standalone today; it is **not** wired into
    `compose.yaml` yet, so the running stack is unaffected.
  - Next step (when a task requires it): add a `backend` compose service
    (profile `agents` or a new profile) and use `/healthz` as its
    compose healthcheck.
