# ARCHITECTURE.md

System design, tech stack, module boundaries, data flow, and
contracts of the **ai-dev-team** platform skeleton, plus the
architecture review verdict for TASK-179 (Redmine-mapped review of
the skeleton).

Maintained by the **cto** agent. Read with `README.md`,
`REQUIREMENTS.md`, `DECISIONS.md`.

> History note: an earlier draft of this file (with the TASK-014
> feasibility review) was authored on the `cto/TASK-014-*` branch but
> was never merged into `develop`. This file is the canonical
> version, restored and updated to the current skeleton by TASK-179;
> the feasibility analysis is folded into §6 and §7.

---

## 1. System overview

ai-dev-team is a multi-agent software development team built on
[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness),
orchestrated with Docker Compose. **Eight** headless DSH agents —
**pm**, **ba**, **backend**, **frontend**, **tester**, **reviewer**,
**cto**, **accountant** — plus an interactive **owner** assistant each
run in their own container with their own isolated workspace,
coordinated by a small orchestrator (PostgreSQL task DB + Redis event
bus + HTTP API). Redmine is the human-facing project-management layer,
reached by agents through an MCP bridge and by the orchestrator
through a two-way REST sync. MCP bridges add browser testing
(Playwright), GitHub PR tooling, and Odoo accounting reads.

```text
                    local machine
                         │
                 docker compose (layers + profiles)
                         │
        ┌────────────────┼──────────────────┐
        │                │                  │
        ▼                ▼                  ▼
   dsh-pm  dsh-ba  dsh-backend        dsh-owner (web UI :3080)
   dsh-frontend dsh-tester        dashboard (task board :8080)
   dsh-reviewer dsh-cto           redmine   (PM UI :3000)
   dsh-accountant (Odoo MCP)
   (8 x DSH,     orchestrator      postgres (17-alpine)
    one image)   (API :8000)       redis (8-alpine)
        │                │
        └────────────────┼─────────────────┘
                         │
              agent runner (node, zero deps)
                         │
              dsh --profile headless "<task>"
                         │
              git branch ──► PR ──► next agent
```

Compose is split into layers (Compose `include` + profiles):

| File | Contents | Profile |
|---|---|---|
| `compose.yaml` | postgres, redis, orchestrator, dashboard, dsh-owner | (always on) |
| `compose.agents.yaml` | the 8 headless agents | `--profile agents` |
| `compose.integrations.yaml` | redmine-db, redmine, redmine-mcp, playwright-mcp, github-mcp, odoo-mcp | `--profile integrations` |

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Agent runtime | DeepSeek Harness (DSH), built from source | Pinned `DSH_REF` commit (`cd5ef81`, master @ `0.1.2-alpha.1`); headless profile; one-shot sessions |
| Model | DeepSeek API (`deepseek-v4-flash`) | `DEEPSEEK_API_KEY` in every agent container |
| Orchestrator | Node.js 20+ + TypeScript, Fastify 5 | HTTP API :8000; Postgres = source of truth; Redis = event bus only |
| Agent runner | zero-dep Node (`agent-runner/runner.js`) | register → heartbeat → long-poll → `dsh headless` → result |
| DB / cache | PostgreSQL 17, Redis 8 (alpine images) | Bind-mounted `./data/{postgres,redis}`; not exposed to host |
| Backend service (skeleton) | Node.js 20+ + TypeScript, Fastify 5 (`backend/`, PR #2 TASK-174) | Standalone package, same conventions as orchestrator; **not yet wired into compose** |
| Frontend / dashboard | Vite + React app shell / single-file static board behind nginx | nginx proxies `/api` to orchestrator |
| Human layer | Redmine 6.0 + `redmine-mcp` bridge (streamable-http :8000) | API key held only by the bridge; orchestrator two-way REST sync |
| Browser testing | `playwright-mcp` (streamable-http :8931, headless Chromium) | Screenshots land in tester workspace `artifacts/` |
| GitHub | `github-mcp` (official server, digest-pinned, :8989) | Bearer auth from env at boot (`!!js` in patch) |
| Odoo | `odoo-mcp` (pinned PyPI version, streamable-http :8000) | Read-only by design; `ODOO_*` credentials held by the bridge only |
| Exchange medium | Git (branch → PR → next agent) | Never shared files between agents |

One **shared DSH image** (`docker/dsh/Dockerfile`) serves every agent
container; services differ only by `AGENT_ID` / `AGENT_ROLE` /
workspace mount / `AGENTS.md` overlay / DSH home patch.

## 3. Module boundaries & data flow

- **Orchestrator** (`orchestrator/`) owns all state: `agents`,
  `projects`, `tasks`, `task_dependencies`, `agent_runs`,
  `pull_requests`, `events`, `schema_migrations` (see
  `migrations/001_init.sql` + `002_redmine_sync.sql`). Dispatch lives
  in Postgres: `POST /tasks/:id/dispatch` inserts a `pending` run;
  the runner's `GET /agents/:id/next` claims it atomically
  (`pending` → `running`). Redis is pub/sub only (`events:all`) — a
  wedged Redis cannot stall dispatch.
- **Agent runner** (`agent-runner/runner.js`) — the process every DSH
  container starts: register → heartbeat (15s) → long-poll (≤30s) →
  execute `dsh --profile headless "<prompt>"` in its own workspace →
  report result (status, exit code, output tail, branch, PR URL).
  Zero dependencies; never touches Postgres/Redis directly.
- **Agent workspaces** (`workspaces/<agent>/`) — one isolated project
  copy per agent, bind-mounted at `/workspace/project`. No
  filesystem sharing between agents. `AGENTS.md` (role instructions)
  and skills are mounted **read-only** from `agents/`.
- **MCP bridges** — DSH attaches servers via a home-level patch
  (`$DSH_HOME/cordis.patch.yml`): Redmine (pm/ba/tester/cto/owner),
  GitHub (backend/frontend/reviewer), Playwright (tester), Odoo
  (accountant). All bridges fail open (`failOnStartupError: false`,
  auto-reconnect), so a down bridge degrades tool availability but
  never blocks an agent boot.
- **Redmine sync** (`orchestrator/src/redmine.ts`) — Direction 1:
  open Redmine issues whose subject matches `[<agent>] <title>`
  (tracker "Task") are imported as orchestrator tasks every 30s
  (idempotent via `tasks.redmine_issue_id`, never auto-dispatched).
  Direction 2: on run result the linked issue is closed
  (`succeeded`) or rejected (`failed`) with a note carrying summary /
  branch / PR URL. Always fail-open; disabled without
  `REDMINE_API_KEY`.
- **Git flow** — agents never commit to `develop`; each task works on
  `<agent>/TASK-<id>-<slug>`, pushes, and opens a PR against
  `develop`. The runner injects
  `https://x-access-token:<token>@...` into the workspace `origin`
  remote at run time. Confidential agents (accountant) get
  no-push/no-PR prompts (`orchestrator/src/git.ts`,
  `CONFIDENTIAL_AGENTS`).

## 4. Contracts (stable)

### 4.1 Orchestrator HTTP API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/projects` | create a project (`repository_url`, `default_branch`) |
| GET | `/api/projects` | list projects |
| POST | `/api/tasks` | create a task (`depends_on` supported; FK-validated agent) |
| GET | `/api/tasks?status=&agent=&project_id=` | list tasks |
| GET | `/api/tasks/:id` | task + dependencies |
| POST | `/api/tasks/:id/dispatch` | queue the task for its agent (Postgres-backed) |
| POST | `/api/agents/register` | agent self-registration (runner) |
| GET | `/api/agents` | agent registry + status |
| POST | `/api/agents/:id/heartbeat` | heartbeat (runner, every 15s) |
| GET | `/api/agents/:id/next` | claim next dispatched task, up to ~10s wait (runner) |
| POST | `/api/agents/:id/runs/:runId/result` | run result ingestion (runner) |
| POST | `/api/events` | record an event |
| GET | `/api/events?limit=` | recent events |
| GET | `/healthz` | liveness (DB check; compose healthcheck) |

Bodies are schema-validated (Fastify/AJV). Dispatch state transitions:
`pending → running → succeeded|failed`; task: `todo|failed|blocked →
in_progress → done|failed`; on success, dependents whose
prerequisites are all done are auto-dispatched.

### 4.2 Runner ↔ orchestrator protocol

`POST /agents/register`, `POST /agents/:id/heartbeat`,
`GET /agents/:id/next` (200 `{run_id, agent_id, workspace, prompt,
task, project}` | 204), `POST /agents/:id/runs/:runId/result`
(`{status: succeeded|failed, exit_code, output, branch, pr_url,
summary}`).

### 4.3 MCP bridges

streamable-http JSON-RPC: `redmine-mcp` :8000/mcp, `playwright-mcp`
:8931/mcp, `github-mcp` :8989/mcp, `odoo-mcp` :8000/mcp. All
internal-only (not published to the host). Tools appear as
`mcp__<serverName>__<tool>`.

### 4.4 DB schema

`agents`, `projects`, `tasks` (+ `redmine_issue_id` partial-unique
index), `task_dependencies`, `agent_runs`, `pull_requests`, `events`,
`schema_migrations`. Migrations are idempotent, applied automatically
on orchestrator boot (`orchestrator/src/migrate.ts`).

## 5. Security model (as built)

- **No `.env` in git.** `DEEPSEEK_API_KEY` is injected by compose.
- **Credentials are split:**
  - `DEEPSEEK_API_KEY` — present in every agent container env.
  - `GITHUB_TOKEN` — **shared by all agents**; injected into each
    workspace's `.git/config` by the runner (never stored in the DB
    or run logs, but **written to the bind-mounted workspace on the
    host**). Known blocker (see §7.1).
  - `REDMINE_API_KEY` — held only inside `redmine-mcp` and the
    orchestrator env; agents never see credentials.
  - `ODOO_*` credentials — held only inside `odoo-mcp`; the bridge is
    read-only by design (`ODOO_MCP_ENABLE_WRITES` never set).
  - `github-mcp` reads `GITHUB_TOKEN` from env at boot (`!!js`),
    never written into the patch file.
- **Containers run as root** (`user: "0:0"`) with
  `DSH_PERMISSION_MODE=danger-full-access` and approval policy
  `never` — accepted because each agent is isolated by its own
  container + workspace; **never expose these containers to untrusted
  workloads** (prototype posture; see §7.1).
- **Confidential data policy** — `SECURITY.md` classifies business
  data as workspace-local (never committed/pushed), credentials as
  `.env`/bridge-only, and source as public. `CONDUCT.md` adds
  professional ethics for the accountant agent. Enforced by role
  AGENTS.md, the MONTHLY CLOSING skill, and the orchestrator prompt
  for confidential agents.
- **Postgres/Redis are not exposed** to the host. Only the
  orchestrator API is published (`localhost:8000`), plus owner
  (:3080), dashboard (:8080), redmine (:3000).

## 6. TASK-179 — Architecture review of the skeleton

Scope reviewed: the platform skeleton on `develop` (compose layers,
orchestrator, agent runner, agents, MCP bridges, Redmine sync,
SECURITY.md/CONDUCT.md), the backend service skeleton proposed in
PR #2 (`backend/`, TASK-174), and the BA's requirements baseline
(`REQUIREMENTS.md`, PR #3, TASK-178). Baseline: this file,
`DECISIONS.md`, `README.md`, and the TASK-014 feasibility analysis.

### Verdict: **APPROVE**

The skeleton's tech stack, module boundaries, and contracts are
internally consistent and match the documented design:

- **Tech stack consistency** — one stack convention (Node ≥ 20 +
  TypeScript strict + Fastify 5 + pnpm + NodeNext ESM + multi-stage
  Dockerfile) is shared by `orchestrator/` and the new `backend/`
  package (PR #2); the DSH agent image is built once and reused by
  all agents; third-party bridges are pinned (tag or digest).
- **Module boundaries are clean** — orchestrator owns all state;
  runner is zero-dep and touches only the orchestrator API; agent
  workspaces are isolated; MCP bridges hold credentials and fail
  open; the confidential-agent path (accountant) is enforced at the
  prompt level, not just by convention.
- **Contracts are explicit and enforced** — the API is schema-
  validated; the runner protocol is documented (§4.2) and matches
  `runner.js`; the DB schema is migration-managed and idempotent;
  Redmine sync is fail-open and idempotent.
- **Security posture is documented honestly** — the prototype risks
  (root + full-access agents, shared token) are the same blockers
  already recorded by TASK-014 and are not regressions of the
  skeleton; the new accountant/Odoo surface follows the stricter
  no-push/no-PR policy.

### Findings (non-blocking, must be tracked)

| # | Finding | Evidence | Resolution |
|---|---|---|---|
| F1 | Canonical docs missing from `develop`: `ARCHITECTURE.md`, `DECISIONS.md`, `REQUIREMENTS.md` do not exist, yet every task prompt instructs agents to read them | `orchestrator/src/git.ts:42`; `git ls-tree develop` | This PR restores `ARCHITECTURE.md` + `DECISIONS.md`; `REQUIREMENTS.md` is delivered in the BA PR #3 (TASK-178) — track to merge |
| F2 | CI workflow was built (TASK-144) but never merged: `.github/workflows/ci.yml` exists only on the unpushed `cto/TASK-144-*` branch; Redmine #14 was closed prematurely | `git ls-tree -r origin/develop | grep .github` → none; Redmine #14 status=Closed | Land CI (orchestrator build/typecheck, runner `node --check`, orchestrator image build) on `develop` before any `release/`; this is a **release gate** |
| F3 | Backend skeleton (PR #2) is standalone and not wired into the running stack | `backend/README.md`, DECISIONS.md ADR-001 (accepted consequence) | Required follow-up: add a `backend` compose service + use `/healthz` as its healthcheck when the skeleton graduates |
| F4 | `.gitignore` on `develop` lacks `.dsh/` and `.agent-team/` (the ignore commit `8eb214d` lives on an unmerged branch), so an agent `git add -A` can commit DSH state (run logs, config) | `.gitignore`; `git log origin/develop -- .gitignore` | Fixed in this PR (add `.dsh/`, `.agent-team/`, `.pnpm-store/`) |
| F5 | README drift: directory layout still says `docker-compose.yml` (renamed to `compose.yaml` layers); "compose uses named volumes by default" is wrong (bind mounts); "Next steps: task tracker adapter" lists as unimplemented what §"Project management loop" now ships | `README.md:69`, `README.md:122`, `README.md:521-527` | Fixed in this PR |
| F6 | Minor smells: `GITLAB_TOKEN` is dead config (`orchestrator/src/config.ts`); Redmine sync hardcodes tracker/status ids (`redmine.ts:24-28`) coupling to seeded Redmine data; `workspaces/accountant/.gitkeep` missing; runner heartbeat sends `current_run_id` the API schema strips (harmless) | code | Track as cleanup; no contract impact |

### Review notes on PR #2 (backend skeleton)

The `backend/` package (Fastify 5, pure liveness `/healthz` →
`{"ok": true}`, metadata route `/`, `node:test` unit tests + real-HTTP
smoke, multi-stage Dockerfile, `BACKEND_PORT` config) follows the
orchestrator conventions and its contract is minimal and testable.
The root `DECISIONS.md` added by the backend agent is adopted into
the canonical file (ADR-001), and the BA's scope ADRs from PR #3 are
adopted as ADR-002/ADR-003. Going forward, ADR entries are proposed
by any agent but **numbered, approved, and owned by the cto** on
merge (see `DECISIONS.md`), so parallel PRs never fight over ADR
numbers.

## 7. Technical debt & production-readiness (tracked)

### 7.1 Known blockers (from TASK-014 feasibility, still open)

1. **Credential broker / scoped secrets** — replace the shared
   `GITHUB_TOKEN` written into workspaces with per-agent, per-repo,
   short-lived credentials (extension point:
   `orchestrator/src/git.ts`). *(Blocking for production)*
2. **Least-privilege execution** — drop `user: "0:0"` +
   `danger-full-access`; real sandbox (bubblewrap/Landlock) or
   per-task ephemeral containers. *(Blocking for production)*
3. **Protected-path rule** — pre-merge check that PRs touching
   `agents/`, `orchestrator/`, compose files, `.github/` from agent
   branches require explicit cto review; reject silent changes to
   `AGENTS.md` sources. *(Blocking for production)*

### 7.2 Other tracked debt

- CI not yet on `develop` (F2) — release gate.
- Backend skeleton not in compose (F3).
- No per-run token/cost metering (usage records exist in DSH session
  JSONL; harvest into `agent_runs`).
- No automated retry/backoff in the runner for transient
  model/MCP/network errors; a failed run is simply `failed`.
- Redmine ↔ orchestrator sync exists; GitHub Issues/Jira adapters
  can follow the same shape (`orchestrator/src/redmine.ts`).
- Branch-cut hygiene (recurring cost, TASK-003 incident): keep
  `--onto develop` guidance in the git-branching skill.

## 8. agent-desktop — memory foundation (v0.4) + GEPA boundary (Q4/Q5)

> Status: proposed (v1.0) by T02 (TASK-6539 / Redmine #27); details in
> `docs/memory-spec.md` (T01, PR #9) and
> `docs/security-review-memory.md` (T02, this PR). Decisions: ADR-009
> (Q4 boundary), ADR-010 (Q5 judge-team security).

`agent-desktop` is a DSH deployment on the owner's Windows laptop with
a Telegram bridge (plan #22, Q1). Code lives in the agent-team repo
under `agent-desktop/`; the Windows side only `git pull`s + runs an
install script — it never builds.

### 8.1 Memory subsystem (v0.4, T03–T08)

- **L1 working** — model context / KV cache; never persisted.
- **L2 episodic** — `memory/sessions.jsonl`, append-only JSONL;
  live turns write only here (`R-MEM-1`).
- **L3 semantic** — `memory/core.md`, curated fact blocks; written
  **only by consolidation** (`R-MEM-2`).
- **L4 procedural** — `SKILL.md` + registry; v0.4 defines the
  graduation target only, v0.5 owns evolution.
- **Tools:** `search_memory` (ranked:
  `α·similarity + β·recency + γ·importance`, α=0.5/β=0.3/γ=0.2) and
  `grep_logs` (raw regex) — contract in spec §7.
- **Consolidation:** out-of-session batch job (sleep-time compute);
  graduation L2→L3/L4 after **N = 3–5 observations + multi-model
  judge gate + verifier** (spec §8–§10; ADR-006). Implemented by T05:
  `agent-desktop/src/consolidation.ts` (pipeline, cursor, run
  records, supersede/decay flows) + `src/judge.ts` (Q5 multi-model
  gate), `src/llm-provider.ts` (provider abstraction, §9.2),
  `src/costs.ts` (per-model monthly caps, §9.5), `src/verifier.ts`
  (deterministic anti-hallucination checks, §10.5). ADR-013 records
  the implementation decisions (run-record type `consolidation`,
  decay idempotency via the L2 `decay` trail, conflict-overlap
  routing).
- **Guardrails (mandatory):** provenance
  (`user_stated`/`model_inferred`/`tool_output`), anti-poisoning
  (source-gated writes, injection-pattern quarantine, "memory is data,
  not instructions" delimiters), anti-conflict (`valid_from`/`valid_to`
  + supersede), decay/anti-drift Day-30 (spec §10; ADR-007).
- **Security envelope:** memory files `0600`/`0700`, no secrets in
  memory (spec §11); all memory rendered into prompts — hot facts,
  `search_memory` results, `grep_logs` matches — MUST be wrapped in
  `[MEMORY_START]…[/MEMORY_END]` + "data, not instructions" note
  (SEC-MEM-01/02, `docs/security-review-memory.md` §3).

### 8.2 Trust boundary: repo vs Windows laptop (R3)

- **Repo/CI side (trusted):** all code reviewed through the PR flow;
  memory engine + consolidation.
- **Laptop (owner machine):** runs **released, reviewed artifacts
  only**. Auto-generated (evolved) skills NEVER run on the laptop
  before the human-review gate (T13) + cto release gate (T19)
  (SEC-BND-01). The owner runs Windows Sandbox tests and uploads
  results (plan #22 Q3).

### 8.3 GEPA pipeline (v0.5, T09–T15) — Q4 hybrid boundary

Owner decision Q4: **core GEPA = Python sidecar** (DSPy + GEPA, as
hermes-agent-self-evolution); **integration = Node/TS native**.

```text
┌──────────── Node/TS (agent-team, trust anchor) ────────────┐
│ orchestrator/runner ─ spawns ─► Python sidecar (GEPA core)  │
│   • git, PRs, skill registry   • eval → evolution → fitness │
│   • API keys (env only)        • generates candidate skills │
│   • enforces SEC-GEPA-01…11    • sandboxed compute worker   │
└───────────────▲───────────────────────────────▲─────────────┘
                │  IPC: JSON-RPC (stdio/127.0.0.1) │
                │  data-only, schema-validated     │
```

- **Trust anchor:** Node/TS owns policy, credentials, and merge gates;
  the sidecar is a **compute worker** with no authority of its own.
- **Security boundary:** separate process, per-run sandbox, non-root,
  data-only IPC (no command channel, no callbacks), output
  re-validation in Node (size/semantic/test gates are not
  self-reported), per-job resource + cost caps (ADR-009).
- **Security requirements SEC-GEPA-01…11** (isolation, test suite
  100%, size ≤ 15 KB, semantic preservation, no hot-swap, human review
  before merge, no auto-merge, no secrets in candidates, cost caps,
  dependency pinning, audit trail) — full list in
  `docs/security-review-memory.md` §5. T09 must implement all of them.

### 8.4 Multi-model judge team (Q5) — security

- Functional contract: `LLMProvider` abstraction, panel
  gpt-4 / gemini-3 / deepseek, per-model cost caps, default DeepSeek
  only (spec §9; ADR-008).
- Security envelope: keys env-only and never in logs/artifacts
  (SEC-KEY-01…03), per-model caps with safe pause when all capped
  (SEC-COST-01/02), redaction before logging + secret-scan guard
  (SEC-LOG-01/02) — `docs/security-review-memory.md` §7; ADR-010.
- Keys pending from the owner: `OPENAI_API_KEY` (gpt-4),
  `GEMINI_API_KEY` (gemini-3).
