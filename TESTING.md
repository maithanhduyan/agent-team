# TESTING.md

QA test plans and results for the agent-team project. Maintained by the
**tester** agent.

---

## TASK-176: QA — test plan for the skeleton

- **Date:** 2026-08-30 (session)
- **Under test:**
  - Backend `/healthz` endpoint — `backend/` service skeleton from
    PR #2 / branch `backend/TASK-174-backend-service-skeleton-wit`
    (Fastify 5 + TypeScript, standalone package; not yet merged into
    `develop`).
  - Frontend shell — Vite 5 + React 18 app shell from TASK-002
    (commit `ce6b4a4` "feat(frontend): add app shell with hello
    button"; the source branch was deleted upstream, so tests run
    against that pinned commit).
- **Acceptance criteria (from the task graph seed + task description):**
  1. A test plan exists covering the backend `/healthz` endpoint and
     the frontend shell.
  2. The backend service exposes `GET /healthz` returning JSON
     `{"ok": true}` and a smoke test proves it works.
  3. The frontend shell loads and its shell elements render and
     respond.
  4. Suite executed against the code under test; results recorded with
     PASS/FAIL + evidence.

### Test plan — backend `/healthz` (TC-B)

| # | Criterion | Steps | Expected |
|---|-----------|-------|----------|
| TC-B01 | TypeScript check passes | `pnpm install`; `pnpm typecheck` | exit 0, no TS errors (strict, src + test) |
| TC-B02 | Unit tests pass | `pnpm test` | 4/4 pass (Fastify `inject()`: `/healthz` 200 + `{"ok":true}` + `application/json`; `/` metadata; 404 unknown route) |
| TC-B03 | Real-HTTP smoke test passes | `pnpm smoke` (builds + boots compiled server on ephemeral port) | `GET /healthz` → 200 `{"ok":true}` `application/json`; SIGTERM → clean exit 0; script prints `smoke: OK` |
| TC-B04 | Live `GET /healthz` over real HTTP | boot `dist/server.js` on a fixed port; `curl -i http://127.0.0.1:<port>/healthz` | HTTP 200; body exactly `{"ok":true}`; `Content-Type: application/json` |
| TC-B05 | Live `GET /` metadata route | `curl -s http://127.0.0.1:<port>/` | 200; `{"service":"backend","version":"0.1.0","status":"ok","health":"/healthz"}` |
| TC-B06 | Unknown routes → 404 | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:<port>/nope` | HTTP 404 |
| TC-B07 | HEAD-style probe | `curl -sI http://127.0.0.1:<port>/healthz` | HTTP 200 (Fastify default) |
| TC-B08 | Port configuration respected | boot with `BACKEND_PORT=4321`; curl `127.0.0.1:4321/healthz` | 200 `{"ok":true}` on the configured port; default `PORT` fallback |
| TC-B09 | Graceful shutdown on SIGTERM | start server, send SIGTERM, observe exit code | process exits 0, logs "SIGTERM received, shutting down" |
| TC-B10 | Liveness probe is dependency-free | boot server with no DB/Redis env or services | `/healthz` answers 200 as soon as the process is up (no external deps) |

### Test plan — frontend shell (TC-F)

| # | Criterion | Steps | Expected |
|---|-----------|-------|----------|
| TC-F01 | Dev server serves the app | `npm install`; `setsid nohup npx vite --host 0.0.0.0 --port 5173 &`; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/` | HTTP 200; served HTML contains `<h1>Agent Team App</h1>` and `<button id="hello-btn">` |
| TC-F02 | Heading `Agent Team App` visible | `browser_navigate` to app URL; `browser_snapshot` / `browser_verify_element_visible` | `<h1>Agent Team App</h1>` visible (level 1 heading) |
| TC-F03 | Hello button renders | `browser_verify_element_visible` on button | `<button id="hello-btn">Say hello</button>` present and visible |
| TC-F04 | React shell mounts | `browser_verify_text_visible` | text `React app shell is mounted.` visible in `#root` |
| TC-F05 | Clicking hello shows greeting | `browser_click` on `#hello-btn` | button text becomes `Hello from agent-team` |
| TC-F06 | No fatal console errors | read browser console after load + click | no uncaught JS errors / 4xx-5xx app resource failures (favicon 404 known & excluded) |
| TC-F07 | Screenshot evidence | `browser_take_screenshot TASK-176-frontend-shell.png` | PNG saved to `artifacts/` and committed |

### Results

| # | Result | Evidence |
|---|--------|----------|
| TC-B01 | _pending_ | |
| TC-B02 | _pending_ | |
| TC-B03 | _pending_ | |
| TC-B04 | _pending_ | |
| TC-B05 | _pending_ | |
| TC-B06 | _pending_ | |
| TC-B07 | _pending_ | |
| TC-B08 | _pending_ | |
| TC-B09 | _pending_ | |
| TC-B10 | _pending_ | |
| TC-F01 | _pending_ | |
| TC-F02 | _pending_ | |
| TC-F03 | _pending_ | |
| TC-F04 | _pending_ | |
| TC-F05 | _pending_ | |
| TC-F06 | _pending_ | |
| TC-F07 | _pending_ | |

**Overall verdict:** _pending_
