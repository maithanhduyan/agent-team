# Requirements — demo-project skeleton

> **Status:** proposed (v1.0) · **Owner:** Business Analyst (ba)
> **Task:** TASK-178 — BA: user stories and acceptance criteria for the skeleton
> **Applies to:** `demo-project` — backend service skeleton (`backend/`) and
> frontend app shell (Vite + React)
> **Last updated:** 2026-08-30

This document is the single source of truth for **what** the skeleton must
do. It is consumed by the implementing agents (backend, frontend), the QA
agent (test plan in `TESTING.md`), the reviewer, and the CTO. Related
documents: `README.md` (repo overview), `DECISIONS.md` (scope/architecture
decisions, incl. ADR-001 from the backend skeleton PR), `ARCHITECTURE.md`
(expected from the CTO).

## 1. Purpose and scope

`demo-project` needs a minimal but real vertical slice — a **backend service**
that can prove it is alive, and a **frontend shell** that proves the web app
can be served and navigated. The skeleton exists so that:

- the deployment stack gets a liveness probe it can healthcheck;
- the frontend team gets a working, routable app shell to grow features in;
- the QA agent gets a contract to write a test plan against
  (`TASK-3`/QA task in the seed graph: "test plan covering the backend
  `/healthz` endpoint and the frontend shell").

**In scope for this document:**

1. Backend `GET /healthz` — liveness endpoint contract.
2. Backend service shell around that endpoint (startup, config, shutdown,
   automated proof).
3. Frontend app shell — placeholder home page, established interactions,
   routing, build/dev tooling.

## 2. Terminology

| Term | Meaning |
|---|---|
| **Liveness probe** | An endpoint that reports whether the service *process* is up and able to serve requests. It must not depend on external systems. |
| **Readiness probe** | (Out of scope) An endpoint that reports whether the service is *ready to do real work* (e.g. DB reachable). |
| **Shell** | The minimal frontend application scaffold: entry point, router, placeholder page, build tooling. No business features yet. |
| **Skeleton** | The vertical slice covered by this document: backend service + `/healthz` + frontend shell. |

## 3. User stories

### 3.1 Backend — `/healthz` liveness endpoint

Reference implementation: PR #2 "TASK-174: Backend service skeleton with
`/healthz` endpoint" (`backend/` package, Node.js ≥ 20, TypeScript strict,
Fastify 5, pnpm — same conventions as `orchestrator/`).

#### US-BE-001 — Health endpoint contract

> **As an operator**, I want `GET /healthz` to return HTTP `200` with the
> exact JSON body `{"ok": true}` and `Content-Type: application/json`,
> so that I can probe the service and wire it as a container/load-balancer
> healthcheck.

**Acceptance criteria:**

- AC-1: `GET /healthz` returns HTTP status `200` when the service is running.
- AC-2: The response body is exactly the JSON object `{"ok": true}` — no
  extra fields, no HTML, no wrapping.
- AC-3: The response `Content-Type` is `application/json`.
- AC-4: The endpoint responds within 1 second under no load (a healthcheck
  probe must not hang).

#### US-BE-002 — Liveness without dependencies

> **As an operator**, I want `/healthz` to answer without the database or
> any other external service, so that the probe reflects **process
> liveness** (not dependency health) and the service counts as "up" as soon
> as it can serve requests.

**Acceptance criteria:**

- AC-1: Starting the service with **no database and no external services
  configured** still yields `200 {"ok": true}` from `GET /healthz`.
- AC-2: The `/healthz` handler performs **no I/O to external systems**
  (no DB query, no outbound HTTP, no filesystem dependency) — verifiable by
  code review of the handler.
- AC-3: This is intentionally different from the orchestrator's `/healthz`
  (which does a DB check) — see `DECISIONS.md` ADR-001; the distinction must
  be preserved unless a new decision supersedes it.

#### US-BE-003 — Automated proof (unit + real-HTTP smoke)

> **As a developer**, I want the `/healthz` contract enforced by automated
> tests — a unit test and a real-HTTP smoke test — so that regressions in
> the liveness contract are caught before merge.

**Acceptance criteria:**

- AC-1: A unit test exists that asserts `GET /healthz` → `200`,
  `application/json`, body `{"ok": true}` (e.g. Fastify `inject()`).
- AC-2: A smoke test exists that boots the **compiled** server on an
  ephemeral port, performs a **real HTTP** `GET /healthz`, and asserts
  `200` + `{"ok": true}` + `application/json`.
- AC-3: `pnpm test` (unit) exits `0`.
- AC-4: `pnpm smoke` (real-HTTP) exits `0`.
- AC-5: `pnpm check` (typecheck + test + smoke) exits `0` — this is the
  acceptance gate for the backend skeleton.

#### US-BE-004 — Graceful shutdown

> **As an operator**, I want the service to shut down cleanly on `SIGTERM`
> (and `SIGINT`), so that container orchestration can stop and restart it
> without force-killing the process.

**Acceptance criteria:**

- AC-1: Sending `SIGTERM` to the running service results in process exit
  code `0` within 5 seconds.
- AC-2: The smoke test verifies graceful shutdown on `SIGTERM` as part of
  `pnpm smoke`.

#### US-BE-005 — Configurable runtime

> **As an operator**, I want the service host/port/log level configurable
> via environment variables, so that I can run it in different environments
> and containers without code changes.

**Acceptance criteria:**

- AC-1: `BACKEND_PORT` (fallback `PORT`) sets the listen port; `HOST` sets
  the bind interface; `LOG_LEVEL` sets the log level. Defaults:
  `4000`, `0.0.0.0`, `info`.
- AC-2: Starting the service with `BACKEND_PORT=5001` makes `GET /healthz`
  answer on port `5001` and not on `4000`.
- AC-3: Unknown/absent variables fall back to defaults without crashing.

#### US-BE-006 — Service metadata (discovery)

> **As an operator or a service-discovery tool**, I want `GET /` to return
> service metadata (name, version, status, health endpoint link), so that I
> can identify which service and version is running and where to probe it.

**Acceptance criteria:**

- AC-1: `GET /` returns HTTP `200` with JSON containing `service`
  (`"backend"`), `version` (semver string), `status` (`"ok"`), and `health`
  (`"/healthz"`).
- AC-2: The metadata must not contain secrets or environment internals.

### 3.2 Frontend — app shell

Established conventions (from the first frontend shell iteration, TASK-002,
QA-validated): Vite + React + TypeScript, heading **"Agent Team App"**,
a placeholder body, and a `hello-btn` button. The seed task for this
iteration adds **routing** and a **placeholder home page**.

#### US-FE-001 — Shell renders at `/`

> **As a user**, I want to open the app at `/` and see the app shell —
> the brand heading and a placeholder home page — so that I can confirm the
> application is deployed, served, and reachable.

**Acceptance criteria:**

- AC-1: Serving the app (dev server or production build), `GET /` returns
  HTTP `200` with an HTML page.
- AC-2: The page contains the heading **"Agent Team App"**.
- AC-3: The page shows placeholder home content — the established text
  **"React app shell is mounted."** — indicating the React app mounted
  successfully.
- AC-4: The shell renders **without** the backend service running (the
  placeholder page must not depend on backend API availability).

#### US-FE-002 — Interactive hello button

> **As a user**, I want to click the hello button and see its text change
> to "Hello from agent-team", so that I can verify the client-side
> JavaScript is wired and interactive.

**Acceptance criteria:**

- AC-1: The page contains a button with `id="hello-btn"` and initial label
  "Say hello".
- AC-2: Clicking the button changes its text to **"Hello from agent-team"**.
- AC-3: The control is a native `<button>` element (keyboard-operable) — no
  clickable `<div>`.

#### US-FE-003 — Client-side routing with a home route

> **As a product owner**, I want the shell to provide client-side routing
> with a defined home route at `/`, so that future features can be added as
> additional routes without restructuring the app entry point.

**Acceptance criteria:**

- AC-1: The app entry point wires a client-side routing mechanism with a
  home route at `/` (e.g. react-router or an equivalent, documented choice).
- AC-2: Loading the app at `/` renders the placeholder home page **via the
  router** (not a static fallback).
- AC-3: Navigating to an unknown path (e.g. `/nonexistent`) never renders a
  blank page and never throws an uncaught error — a not-found view, a
  redirect, or a graceful fallback is shown.
- AC-4: Adding a new route does not require rewriting the app entry point
  (routes are declared in a single routable structure).

#### US-FE-004 — Standard build & dev tooling

> **As a developer**, I want the shell to use the standard Vite scripts
> (`dev`, `build`, `preview`) and the established stack, so that the app can
> be built, previewed, and CI'd without custom tooling.

**Acceptance criteria:**

- AC-1: `package.json` declares the established stack — `vite`,
  `@vitejs/plugin-react`, `react`, `react-dom` — and scripts `dev`,
  `build`, `preview`.
- AC-2: The project is TypeScript (`tsconfig.json` present; entry point
  `src/main.tsx`).
- AC-3: `npm run build` (or `pnpm build`) exits `0` and produces a `dist/`
  bundle.
- AC-4: `npm run dev` starts a server that serves the app (`GET /` →
  HTTP `200`).
- AC-5: The production build completes without type errors.

## 4. Non-functional requirements

- **Backend:** Node.js ≥ 20, TypeScript strict, Fastify 5 — mirroring the
  `orchestrator/` conventions (pnpm, NodeNext ESM, `dist/` build output,
  multi-stage Dockerfile). No new runtime dependencies beyond what the
  skeleton needs.
- **Frontend:** Vite + React + TypeScript (established). No backend
  dependency for the placeholder page. Basic accessibility: semantic
  heading and native button.
- **Security:** Neither `/healthz` nor `/` may leak environment details,
  secrets, or stack internals.
- **Performance:** `/healthz` responds in ≤ 1 s under no load.
- **Verifiability:** every user story above has acceptance criteria that
  the QA agent can execute (commands, HTTP checks, Playwright UI checks).

## 5. Out of scope (this iteration)

- Authentication / authorization.
- Database access or business logic in the backend service (no data
  endpoints yet).
- A readiness probe (dependency-aware health) — revisit when the service
  gains real dependencies.
- Wiring the backend service into `compose.yaml` and using `/healthz` as a
  compose healthcheck — tracked as a consequence of ADR-001 (follow-up).
- Frontend styling framework / design system, real pages, backend
  integration.
- CI jobs for `backend/` and the frontend package (the current CI task
  covers the orchestrator only).

## 6. Gaps, risks and open questions

1. **Liveness vs. readiness.** The backend `/healthz` is a pure liveness
   probe (no DB), deliberately different from the orchestrator's
   DB-checked `/healthz`. Risk: operators may mistake it for a readiness
   signal. Mitigation: documented here and in ADR-001; add a readiness
   endpoint when the service gains dependencies (out of scope now).
2. **Routing gap in the first shell iteration.** The seed description for
   the frontend task asked for routing, but the first iteration (TASK-002)
   shipped without a router. The current iteration must add routing
   (US-FE-003); the QA test plan must verify it, not just the placeholder
   page.
3. **Shared `DECISIONS.md`.** `DECISIONS.md` is introduced by both the
   backend skeleton PR (ADR-001) and this requirements PR (ADR-002+).
   Whichever merges second must reconcile the file (trivial append, but
   needs care).
4. **Placeholder text coupling.** The tester's UI checks reference the
   established placeholder text ("React app shell is mounted."). If the
   frontend changes it, the tester's plan must be updated in the same
   iteration.
5. **No CI for the skeleton packages yet.** `backend/` tests
   (`pnpm check`) and the frontend build are not yet in CI; until then,
   verification relies on the QA agent executing them locally. Recommended
   follow-up: extend the CI workflow to `backend/` and the frontend.
6. **Open question — button text copy.** The established interaction uses
   the label "Say hello" → "Hello from agent-team". Confirm whether this
   copy should be product-branded in a later iteration (kept as-is for the
   skeleton).

## 7. Traceability

| Artifact | Reference |
|---|---|
| Task | TASK-178 (BA user stories & acceptance criteria) |
| Backend task (T1) | "Backend: service skeleton with health endpoint" → backend/TASK-174 PR #2 |
| Frontend task (T2) | "Frontend: app shell with routing" (seed graph) |
| QA task (T3) | "QA: test plan for the skeleton" — consumes §3 acceptance criteria |
| Backend decision | `DECISIONS.md` ADR-001 (backend PR #2) |
| BA scope decisions | `DECISIONS.md` ADR-002, ADR-003 (this PR) |
| Redmine | Requirements wiki page + requirement ticket (see DECISIONS.md / PR) |
