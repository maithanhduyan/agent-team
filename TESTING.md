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

Environment: backend suite run in a worktree checked out at
`dd7082f` (PR #2 head) — `backend/` package, pnpm 11.7.0, Node
v24.20.0. Live HTTP checks booted the compiled `dist/server.js`.

| # | Result | Evidence |
|---|--------|----------|
| TC-B01 | ✅ PASS | `pnpm typecheck` exit 0 (`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit`) |
| TC-B02 | ✅ PASS | `pnpm test` → `ℹ tests 4 / pass 4 / fail 0` (`GET /healthz` 200 `{"ok":true}` + `application/json`; `/` metadata; 404 unknown route) |
| TC-B03 | ✅ PASS | `pnpm smoke` → `smoke: PASS GET /healthz -> 200 {"ok":true} (application/json)`; `smoke: PASS graceful shutdown on SIGTERM (exit 0)`; `smoke: OK` (exit 0) |
| TC-B04 | ✅ PASS | `curl -si http://127.0.0.1:4789/healthz` → `HTTP/1.1 200 OK`, `content-type: application/json; charset=utf-8`, body `{"ok":true}` |
| TC-B05 | ✅ PASS | `curl -s http://127.0.0.1:4789/` → `{"service":"backend","version":"0.1.0","status":"ok","health":"/healthz"}` |
| TC-B06 | ✅ PASS | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4789/nope` → `404` |
| TC-B07 | ✅ PASS | `curl -sI http://127.0.0.1:4789/healthz` → `HTTP/1.1 200 OK` |
| TC-B08 | ✅ PASS | `BACKEND_PORT=4321` → 200 `{"ok":true}` on 4321; `PORT=4788` fallback → 200 on 4788; no env → default 4000 → 200 |
| TC-B09 | ✅ PASS | SIGTERM → process exits 0 (`wait` → 0); log line `"SIGTERM received, shutting down"` at LOG_LEVEL=info |
| TC-B10 | ✅ PASS | server booted with no DB/Redis env or services in all runs; `/healthz` answered 200 immediately (pure liveness probe by design) |
| TC-F01 | ✅ PASS | Vite 5.4.21 dev server on `0.0.0.0:5173`; `curl http://127.0.0.1:5173/` → HTTP 200; served HTML contains `<h1>Agent Team App</h1>` and `<button id="hello-btn">` |
| TC-F02 | ✅ PASS | `browser_verify_element_visible` — `getByRole('heading', { name: 'Agent Team App' })` visible (snapshot: heading level=1) |
| TC-F03 | ✅ PASS | `browser_verify_element_visible` — `getByRole('button', { name: 'Say hello' })` visible (snapshot: `button "Say hello"`) |
| TC-F04 | ✅ PASS | snapshot shows `paragraph: React app shell is mounted.` inside `#root` (React mounted) |
| TC-F05 | ✅ PASS | `browser_click` on the hello button; `browser_verify_text_visible` — `getByRole('button', { name: 'Hello from agent-team' })` visible |
| TC-F06 | ✅ PASS | browser console after load + click: 1 error total — the known `favicon.ico` 404 (excluded by the plan); no uncaught JS errors, no other failed resources |
| TC-F07 | ✅ PASS | `browser_take_screenshot TASK-176-frontend-shell.png` → `artifacts/TASK-176-frontend-shell.png` (PNG 1280x720, signature verified) |

**Overall verdict: ✅ PASS (17/17 — backend 10/10, frontend shell 7/7)**

### Observations / known issues

- **MINOR — missing favicon (404).** Loading the frontend shell logs
  `Failed to load resource: 404 @ /favicon.ico` (browser console).
  Cosmetic only; no acceptance criterion affected. Repro: load
  `http://<vite-network-addr>:5173/` and read the console. Suggested
  fix: add a `<link rel="icon">` or `favicon.ico` to `index.html`.
  **Redmine issue: #18** (Bug, Normal — tracked for a future fix).
- **MINOR — frontend shell has no routing.** The frontend task seed
  described "app shell with routing and a placeholder home page"; the
  implemented shell (TASK-002, `ce6b4a4`) renders a static
  `index.html` + React mount with no router/routes. Not a failure of
  the shell as implemented and previously accepted (TASK-003 5/5);
  recorded as a scope gap for a future task.
  **Redmine issue: #19** (Feature, Normal).

### Recipe note (working URL)

Playwright runs in its own container, so `http://127.0.0.1:5173/` from
the browser resolves to the bridge's loopback and fails. Working recipe
(unchanged from TASK-003):

```bash
cd <frontend-shell-checkout>
npm install
setsid nohup npx vite --host 0.0.0.0 --port 5173 > /tmp/app.log 2>&1 &
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/     # -> 200
# browser target: the 'Network:' address Vite prints to /tmp/app.log
# (e.g. http://172.25.0.18:5173/) — never the container's 127.0.0.1
grep -o "http://[0-9.]*:5173" /tmp/app.log | tail -1
```
