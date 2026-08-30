# Decisions (ADR)

Architecture and scope decisions are recorded here as short ADRs, in
reverse chronological order. Add a new entry whenever a public contract,
the project architecture, or the product scope changes.

> **Note on ADR-001:** recorded by the backend agent in the backend
> skeleton PR ("TASK-174: Backend service skeleton with `/healthz`
> endpoint"). This file is added in parallel by two PRs (backend + BA);
> on merge, keep both ADR-001 and the BA entries below.

## ADR-003 — Frontend shell scope: routing is required, styling is not

- **Status:** accepted (TASK-178)
- **Date:** 2026-08
- **Context:** the seed task for the frontend shell asks for "app shell
  with routing and a placeholder home page". The first shell iteration
  (TASK-002) shipped a working Vite + React placeholder with a hello
  button but **no router**, so the routing requirement was not actually
  met. The QA test plan for the skeleton must verify routing.
- **Decision (BA scope):**
  - The frontend shell **must** provide client-side routing with a home
    route at `/` (US-FE-003 in `REQUIREMENTS.md`). The library is the
    implementer's choice (react-router or equivalent, documented).
  - The established stack and conventions stay: Vite + React +
    TypeScript, heading "Agent Team App", placeholder text "React app
    shell is mounted.", and the `hello-btn` interaction.
  - Styling framework, design system, real pages, and backend
    integration are **out of scope** for the skeleton.
- **Consequences:**
  - The frontend agent's deliverable now has a measurable routing
    acceptance criterion; the tester must exercise it (navigate `/`,
    navigate to an unknown path) in the QA test plan.

## ADR-002 — Skeleton scope: liveness-only health endpoint

- **Status:** accepted (TASK-178)
- **Date:** 2026-08
- **Context:** the backend skeleton exposes `GET /healthz` returning
  `{"ok": true}`. The BA must pin down what this endpoint is *for* so
  that operators, the QA plan, and future work agree on the contract.
- **Decision (BA scope):**
  - `/healthz` is a **liveness probe**: it reports that the service
    process is up and can serve requests, and it must answer without the
    database or any external dependency (US-BE-002 in
    `REQUIREMENTS.md`). This matches the implemented behaviour and
    ADR-001; it differs intentionally from the orchestrator's
    DB-checked `/healthz`.
  - The skeleton requires **no readiness probe**, no authentication, no
    data endpoints, and no compose wiring for the backend service yet —
    those are out of scope (see `REQUIREMENTS.md` §5).
- **Consequences:**
  - "Is the service alive?" and "is the whole stack ready?" are separate
    questions; a readiness probe is a documented follow-up once the
    service gains real dependencies.
  - The QA test plan for `/healthz` (unit + smoke + dependency-free
    start) can be derived directly from `REQUIREMENTS.md` §3.1.
