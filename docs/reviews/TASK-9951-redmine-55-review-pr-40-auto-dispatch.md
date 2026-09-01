# TASK-9951 / Redmine #55 — Review PR #40: auto-dispatch Redmine-imported tasks (orchestrator)

Reviewer: reviewer (reviewer@agent-team.local)
Date: 2026-09-01
PR: https://github.com/maithanhduyan/agent-team/pull/40
Base: `develop` @ `c8ffb74` · Head: `feature/redmine-auto-dispatch` @ `2d7a5d7` (1 commit)
Diff: 5 files, +162/−30 · Typecheck (`tsc --noEmit` on head sources): PASS

## Verdict: ⛔ REQUEST CHANGES

Core auto-dispatch logic is correct (checks 1–3 pass), but the PR bundles an
**out-of-scope, incompletely-wired API-key auth feature** whose docs describe
wiring that does not exist in the repo (check 4/5 fail).

---

## Acceptance checks

| # | Check | Result |
|---|-------|--------|
| 1 | Idempotency import giu nguyen; chi task MOI duoc dispatch | ✅ PASS |
| 2 | syncRedmine fail-open; backlog query dung | ✅ PASS |
| 3 | Flag mac dinh true, doc env 'false' chinh xac | ✅ PASS |
| 4 | Khong lo secret; khong thay doi thua ngoai 5 file | ⚠️ FAIL (scope + broken wiring, see F1) |
| 5 | Tai lieu (README, .env.example) nhat quan voi code | ⚠️ FAIL (F1, F2) |

### Check 1 — PASS
- `orchestrator/src/redmine.ts:103-111` keeps `on conflict do nothing returning
  id`; `rows.length === 0` → `continue` (already imported). Only newly-imported
  ids are pushed to `importedTaskIds` (line 113) and returned (line 126).
- `orchestrator/src/tasks.ts:17` `RUNNABLE_STATUSES = {todo, in_progress,
  failed, blocked}` (not `done`); lines 25-32 throw when there is no assigned
  agent, the status is not runnable, or an active run (`pending`/`running`)
  exists. Backlog/imported tasks already dispatched are therefore skipped.

### Check 2 — PASS
- `orchestrator/src/server.ts:71` and `:73` both wrap `syncRedmine(...)` in
  `.catch(...)` — a thrown error cannot kill the poller.
- `orchestrator/src/server.ts:101-109`: every `dispatchTask` call is wrapped in
  its own try/catch (fail-open per task).
- Backlog query (server.ts:95-96) is exactly
  `status = 'todo' and redmine_issue_id is not null and assigned_agent is not null`.

### Check 3 — PASS
- `orchestrator/src/config.ts:31`: `redmineAutoDispatch:
  process.env.REDMINE_AUTO_DISPATCH !== 'false'` → default `true`; only exact
  string `'false'` disables. `.env.example:288` documents
  `REDMINE_AUTO_DISPATCH=true`; README documents the behavior.
  (Minor: comparison is case-sensitive — `FALSE` would not disable. Acceptable.)

### Check 4 — ⚠️ FAIL
- Exactly 5 files changed; no secrets in the diff (only placeholders). ✓
- **F1 (blocking): out-of-scope + broken API-key auth feature.** This PR is
  titled *auto-dispatch* but also adds a distributed-mode auth feature
  (`config.apiKey` in `orchestrator/src/config.ts:17-18,32`; auth hook in
  `orchestrator/src/server.ts:32-41`; `API_KEY`/`ORCHESTRATOR_API_KEY`/
  `TRAEFIK_*`/`DSH_OWNER_PORT` docs in `.env.example:199-250`; README identity
  email/port/nginx changes). The feature is **not wired end-to-end**:
  - `compose.yaml` orchestrator `environment:` (lines 70-89) does **not** pass
    `API_KEY` to the orchestrator container (only `REDMINE_API_KEY`).
  - `compose.agents.yaml` does **not** inject `ORCHESTRATOR_API_KEY` into
    agents (only `DEEPSEEK_API_KEY`).
  - `agent-runner/runner.js` does **not** send an `x-api-key` header on
    `/api/agents/:id/next` (line 207) or any other call.
  - `dashboard/nginx.conf` does **not** forward `X-Api-Key`.
  → If an operator follows `.env.example`/README and sets `API_KEY`, the
  orchestrator 401s **every** agent/dashboard request; the system breaks. The
  feature must be either fully wired (compose env + runner header + nginx
  forwarding) or removed from this PR.

### Check 5 — ⚠️ FAIL
- **F2 (doc/code mismatch):** README.md:121 documents
  `dashboard/nginx.conf.template  # proxies /api to the orchestrator (+ X-Api-Key)`,
  but the repo on this branch still has `dashboard/nginx.conf` (no `.template`,
  no `X-Api-Key` forwarding — file unchanged). `.env.example:206-214` claims
  "compose injects it into every agent + owner" and "the dashboard nginx proxy
  forwards it too" — neither is true on this branch (see F1 wiring gaps).
- The auto-dispatch documentation itself (README § Redmine → orchestrator,
  `.env.example:288`) is accurate and consistent with the code. ✓

---

## Observations (không blocking)

- **O1:** Orchestrator has no test suite (`package.json` has no `test` script).
  New logic (`syncRedmine`, return-type change of `importRedmineIssues`) is
  covered only by typecheck. Consider adding a minimal unit test.
- **O2 (pre-existing):** `dispatchTask`'s active-run check
  (tasks.ts:30-32) is check-then-insert (TOCTOU) — two concurrent dispatches of
  the same task could both pass the guard. Pre-existing in the manual dispatch
  route; the 30s poller makes overlap unlikely but possible. Not introduced by
  this PR.

---

## Yêu cầu thay đổi (blocking)

1. **F1 — wire hoặc bỏ API-key auth** (`orchestrator/src/server.ts:32-41`,
   `orchestrator/src/config.ts:17-18,32`): bổ sung đầy đủ wiring (compose env
   `API_KEY` cho orchestrator, `ORCHESTRATOR_API_KEY` cho agents, `x-api-key`
   trong `agent-runner/runner.js`, forward `X-Api-Key` trong
   `dashboard/nginx.conf`) — hoặc tách feature này ra khỏi PR auto-dispatch.
2. **F2 — sửa tài liệu cho khớp code** (`README.md:121`,
   `.env.example:206-214`): đổi `nginx.conf.template` thành `nginx.conf` cho
   đúng trạng thái repo, hoặc thực hiện rename + forwarding thật; bỏ/xác minh
   các khẳng định "compose injects / nginx forwards".

*Note: worktree review — typecheck head sources tại thời điểm review: PASS.*
