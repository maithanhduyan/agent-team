# DECISIONS.md

Every architecture/scope decision and its rationale, as short ADRs,
newest first.

> **Ownership:** the **cto** agent owns this file and
> `ARCHITECTURE.md` (see `agents/cto/AGENTS.md`). Any agent may
> **propose** an ADR (append a candidate entry to the PR that
> implements the change); the cto **approves and assigns the final
> ADR number** when folding it into the canonical file during
> architecture review. Parallel PRs therefore never fight over
> numbers: proposals keep their working numbers on the branch and are
> renumbered on merge (e.g. ADR-001 from the backend skeleton PR,
> ADR-002/ADR-003 from the BA PR — all adopted below).
>
> **History note:** earlier decisions (TASK-014 feasibility, TASK-015
> roadmap) were written on the `cto/TASK-014-*` / `pm/TASK-015-*`
> branches and never merged into `develop`. ADR-000 below restores
> that context; the TASK-179 review is recorded in
> `ARCHITECTURE.md` §6.

## ADR-008 — Canonical architecture docs restored; missing-docs gap closed (TASK-179)

- **Status:** accepted (TASK-179, cto)
- **Date:** 2026-08-30
- **Context:** every agent prompt says *"Read the project
  documentation (README.md, ARCHITECTURE.md, REQUIREMENTS.md,
  DECISIONS.md) before starting"* (`orchestrator/src/git.ts`), but
  none of the three architecture/scope files existed on `develop`.
- **Decision:**
  - Restore `ARCHITECTURE.md` and `DECISIONS.md` as the canonical
    design record, updated to the current skeleton (compose layers,
    eight agents, Redmine two-way sync, Odoo/accountant, backend
    service skeleton).
  - Architecture reviews of agent PRs are recorded here /
    in `ARCHITECTURE.md`; verdicts stay binary **APPROVE** or
    **REQUEST CHANGES** with file/line specifics.
  - `REQUIREMENTS.md` is the BA's deliverable (TASK-178, PR #3) —
    its user stories and acceptance criteria are the requirements
    baseline for the skeleton.
- **Consequences:** the docs baseline now exists; the TASK-179
  review is APPROVE with non-blocking findings F1–F6 (see
  `ARCHITECTURE.md` §6).

## ADR-007 — CI is required before any release; current gap tracked (TASK-179 / TASK-144)

- **Status:** accepted, **gate open** (TASK-179, cto)
- **Date:** 2026-08-30
- **Context:** a GitHub Actions workflow for `develop` (orchestrator
  `pnpm install --frozen-lockfile` + `pnpm build` + `tsc` typecheck,
  agent-runner `node --check`, orchestrator image build) was written
  in TASK-144 (Redmine #14) but the branch was never pushed/merged;
  Redmine #14 was closed prematurely. `develop` still has **no CI**.
- **Decision:**
  - The DSH agent image is deliberately excluded from CI (~3.4 GB
    source build; built once per pinned `DSH_REF` on the host).
  - The CI workflow must land on `develop` **before any `release/`
    branch merges to `main`** — it is a release gate, not a nice-to-
    have. Redmine #14 should be reopened until the workflow is
    merged.
- **Consequences:** "no CI" remains tracked tech debt (§7.2 of
  `ARCHITECTURE.md`) until the workflow lands.

## ADR-006 — Confidential agents: workspace-local deliverables, no push/PR (accountant)

- **Status:** accepted (TASK-179 review)
- **Date:** 2026-08-30
- **Context:** the accountant agent produces month-end closing packs
  containing confidential business data (P&L, balance sheet, VAT,
  trial balance) from Odoo. Publishing those to any repository is a
  data leak.
- **Decision:**
  - Agents whose deliverables are confidential (`CONFIDENTIAL_AGENTS
    = {accountant}` in `orchestrator/src/git.ts`) receive prompts
    that forbid commit/push/PR and require "no business data was
    committed or pushed" for completion.
  - The `odoo-mcp` bridge is **read-only by design**
    (`ODOO_MCP_ENABLE_WRITES` never set) and holds `ODOO_*`
    credentials; agents see only `mcp__odoo__*` tools.
  - Policy is layered: `SECURITY.md` (data classification + incident
    log), `CONDUCT.md` (ethics), the MONTHLY CLOSING skill, and role
    `AGENTS.md`.
- **Consequences:** the read-only/no-push posture is enforced at the
  prompt level, so it holds even if a skill or AGENTS.md copy drifts.

## ADR-005 — Redmine ↔ orchestrator two-way sync (TASK-179 review of #53f8c11)

- **Status:** accepted (TASK-179 review)
- **Date:** 2026-08-30
- **Context:** Redmine was the human layer, but the
  orchestrator↔Redmine mapping was a manual convention in AGENTS.md
  files ("record `Redmine issue: #<id>` in the task description"),
  unenforced and error-prone.
- **Decision:**
  - Direction 1 (Redmine → orchestrator): a poller (every 30s)
    imports open issues whose subject matches `[<agent>] <title>`
    (agent ∈ pm/ba/frontend/backend/tester/reviewer/cto/owner,
    tracker "Task") as tasks linked via `tasks.redmine_issue_id`;
    idempotent, **never auto-dispatches** — dispatch stays a human/
    PM/owner decision.
  - Direction 2 (orchestrator → Redmine): on run result the linked
    issue is closed (`succeeded`) or rejected (`failed`) with a note
    carrying summary, branch, PR URL.
  - Always fail-open; disabled when `REDMINE_API_KEY` is absent.
- **Consequences:** the human↔agent loop is now enforced, not
  conventional. Known coupling: tracker/status ids are hardcoded to
  the seeded Redmine project (`orchestrator/src/redmine.ts:24-28`) —
  tracked cleanup (F6), no contract impact.

## ADR-004 — Compose split into layers + profiles (TASK-179 review of #53f8c11)

- **Status:** accepted (TASK-179 review)
- **Date:** 2026-08-30
- **Context:** a single 486-line `docker-compose.yml` with 19
  services forced the whole stack up even when only core was needed;
  the DSH agent image build (~3.4 GB) and integration services
  (Redmine, MCP bridges) have very different lifecycles.
- **Decision:** split into `compose.yaml` (core, always on) +
  `compose.agents.yaml` (8 headless agents, `--profile agents`) +
  `compose.integrations.yaml` (redmine + MCP bridges,
  `--profile integrations`), composed via Compose `include`.
  `docker-compose.yml` is deleted.
- **Consequences:** partial stack startup works (`make infra`,
  `make agents`, `make integrations`, `make up` for full); profiles
  keep the default `docker compose up -d` to core-only.

## ADR-003 — Frontend shell scope: routing is required, styling is not (TASK-178, BA)

- **Status:** accepted (TASK-178, ba; adopted by cto in TASK-179)
- **Date:** 2026-08
- **Context:** the seed task for the frontend shell asks for "app
  shell with routing and a placeholder home page". The first shell
  iteration (TASK-002) shipped a working Vite + React placeholder
  with a hello button but **no router**, so the routing requirement
  was not actually met. The QA test plan for the skeleton must verify
  routing.
- **Decision (BA scope):**
  - The frontend shell **must** provide client-side routing with a
    home route at `/` (US-FE-003 in `REQUIREMENTS.md`). The library
    is the implementer's choice (react-router or equivalent,
    documented).
  - The established stack and conventions stay: Vite + React +
    TypeScript, heading "Agent Team App", placeholder text "React
    app shell is mounted.", and the `hello-btn` interaction.
  - Styling framework, design system, real pages, and backend
    integration are **out of scope** for the skeleton.
- **Consequences:** the frontend agent's deliverable now has a
  measurable routing acceptance criterion; the tester must exercise
  it (navigate `/`, navigate to an unknown path) in the QA test plan.

## ADR-002 — Skeleton scope: liveness-only health endpoint (TASK-178, BA)

- **Status:** accepted (TASK-178, ba; adopted by cto in TASK-179)
- **Date:** 2026-08
- **Context:** the backend skeleton exposes `GET /healthz` returning
  `{"ok": true}`. The BA must pin down what this endpoint is *for*
  so that operators, the QA plan, and future work agree on the
  contract.
- **Decision (BA scope):**
  - `/healthz` is a **liveness probe**: it reports that the service
    process is up and can serve requests, and it must answer without
    the database or any external dependency (US-BE-002 in
    `REQUIREMENTS.md`). This matches the implemented behaviour and
    ADR-001; it differs intentionally from the orchestrator's
    DB-checked `/healthz`.
  - The skeleton requires **no readiness probe**, no authentication,
    no data endpoints, and no compose wiring for the backend service
    yet — those are out of scope (see `REQUIREMENTS.md` §5).
- **Consequences:** "Is the service alive?" and "is the whole stack
  ready?" are separate questions; a readiness probe is a documented
  follow-up once the service gains real dependencies. The QA test
  plan for `/healthz` (unit + smoke + dependency-free start) can be
  derived directly from `REQUIREMENTS.md` §3.1.

## ADR-001 — Backend service skeleton: standalone Fastify package (TASK-174, backend agent)

- **Status:** accepted (TASK-174; adopted by cto in TASK-179)
- **Date:** 2026-08
- **Context:** `demo-project` needs a backend service exposing a
  `/healthz` liveness endpoint (`{"ok": true}`) and a smoke test
  proving it works. The repository already runs a TypeScript/Fastify
  API (the orchestrator), so the new service should follow the same
  conventions rather than introduce a second stack.
- **Decision:**
  - New standalone package `backend/` (Node.js ≥ 20, TypeScript
    strict, Fastify 5, pnpm) — same layout as `orchestrator/`
    (`src/` → `dist/`, NodeNext ESM, `pnpm-workspace.yaml` esbuild
    allowlist, multi-stage Dockerfile).
  - `GET /healthz` is a **pure liveness probe**: no DB or external
    dependencies, returns exactly `{"ok": true}`. This intentionally
    differs from the orchestrator's `/healthz` (which performs a DB
    check) — the backend service is dependency-free by design.
  - Tests: unit tests via the built-in `node:test` runner with
    Fastify `inject()`; a real-HTTP smoke test (`scripts/smoke.mjs`)
    boots the compiled server on an ephemeral port, asserts `200` +
    `{"ok": true}` + `application/json`, and verifies graceful
    shutdown on `SIGTERM`.
  - Config via environment: `BACKEND_PORT` (falls back to `PORT`),
    `HOST`, `LOG_LEVEL`.
- **Consequences:**
  - The service runs standalone today; it is **not** wired into
    `compose.yaml` yet, so the running stack is unaffected.
  - Next step (when a task requires it): add a `backend` compose
    service (profile `agents` or a new profile) and use `/healthz`
    as its compose healthcheck. (Tracked as finding F3 in the
    TASK-179 review.)

## ADR-000 — Baseline decisions carried from TASK-014 / TASK-015 (context)

- **Status:** carried (see source branches `cto/TASK-014-*`,
  `pm/TASK-015-*`; pending merge of their PRs)
- **Date:** 2026-08
- **Context:** the TASK-014 feasibility review and the TASK-015
  roadmap synthesis were delivered on branches that never merged
  into `develop`. Their conclusions still govern the architecture.
- **Decisions (condensed):**
  - **Feasibility (TASK-014 / Redmine #12):** FEASIBLE as a product,
    NOT production-ready today. Economics attractive at flash-tier
    pricing (≈$2–8/hour full-team model spend); pipeline demonstrably
    delivers end-to-end work. Blockers before production: credential
    broker, least-privilege execution, protected-path rule (see
    `ARCHITECTURE.md` §7.1).
  - **Roadmap / MVP (TASK-015 / Redmine #13):** staged 90-day product
    pilot (v0.4) → MVP hardening (v1.0); go/no-go owned by the
    business owner at the pilot milestone.
- **Consequences:** the demo/team pipeline runs on the prototype
  posture (root + full-access agents, shared token) — acceptable for
  trusted, local workloads only; the blockers are tracked, not
  silently accepted.
