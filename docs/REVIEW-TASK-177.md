# REVIEW — TASK-177: Review the skeleton PRs

- **Reviewer:** reviewer agent
- **Date:** 2026-08-30
- **Scope:** Backend skeleton PR + Frontend skeleton PR (the two skeleton PRs
  of the seeded demo task graph: T1 backend → T2 frontend → review).
- **Docs read per AGENTS.md:** `README.md` (the repo's architecture
  reference; `ARCHITECTURE.md`/`REQUIREMENTS.md`/`DECISIONS.md` do not exist
  on `develop` — `DECISIONS.md` is introduced by these skeleton PRs),
  `agents/reviewer/AGENTS.md`, GIT BRANCHING SKILL, GITHUB WORKFLOW SKILL.

---

## Verdict summary

| PR | Branch | Verdict | Status |
|----|--------|---------|--------|
| [PR #2](https://github.com/maithanhduyan/agent-team/pull/2) — TASK-174 backend service skeleton | `backend/TASK-174-backend-service-skeleton-wit` | **APPROVE** | open |
| [PR #4](https://github.com/maithanhduyan/agent-team/pull/4) — TASK-175 frontend app shell with routing | `frontend/TASK-175-frontend-app-shell-with-rout` | **APPROVE** (with must-reconcile coordination finding) | open |

Both PRs meet their task acceptance criteria and were **independently
verified** (fresh worktrees, real installs/builds/tests), not just taken on
the author's word. Findings are specific and actionable; none block merge of
the skeletons themselves, but the REQUIREMENTS.md copy/hello-button mismatch
(PR #3 vs PR #4) and the shared `DECISIONS.md` triple-add must be reconciled
before QA executes the test plan.

---

## PR #2 — TASK-174: Backend service skeleton with /healthz endpoint

### What was reviewed

Full diff (16 files, +1150, 4 commits) against the TASK-174 acceptance
criteria: a backend service skeleton with a working `GET /healthz` returning
`{"ok": true}` and a smoke test proving it works.

Files reviewed (head `dd7082f`):

- `backend/src/app.ts` — Fastify app factory (`/healthz`, `/`)
- `backend/src/server.ts` — entrypoint, listen, graceful shutdown
- `backend/src/config.ts` — env config (`BACKEND_PORT`/`PORT`, `HOST`, `LOG_LEVEL`)
- `backend/test/healthz.test.ts` — 4 unit tests (node:test + inject)
- `backend/scripts/smoke.mjs` — real-HTTP smoke test
- `backend/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `backend/tsconfig.json`, `tsconfig.test.json`
- `backend/Dockerfile`, `.dockerignore`
- `backend/README.md`, root `README.md`, `DECISIONS.md` (ADR-001), `.gitignore`

### Independent verification (performed by reviewer)

Checked out the PR head in a clean worktree and ran the suite with Node v24 /
pnpm 11.7:

```text
$ pnpm install --frozen-lockfile   # ok
$ pnpm check
  ✔ tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit
  ✔ tsx --test test/*.test.ts
    tests 4, pass 4, fail 0
  ✔ pnpm build && node scripts/smoke.mjs
    smoke: PASS GET /healthz -> 200 {"ok":true} (application/json)
    smoke: PASS graceful shutdown on SIGTERM (exit 0)
    smoke: OK
```

Additional edge probes on the compiled server:

```text
HEAD /healthz -> 200        (Fastify default HEAD handling, OK)
POST /healthz -> 404        (only GET registered, OK)
DELETE /     -> 404
config defaults (no env): port 4000, host 0.0.0.0, level info
```

All claims in the PR description reproduce. The `/healthz` contract
(`200`, `application/json`, body exactly `{"ok":true}`, no external
dependencies) is correct and proven by both unit and real-HTTP tests.

### Acceptance-criteria check

| Criterion (TASK-174 / seed) | Met? | Evidence |
|---|---|---|
| Backend service skeleton in the workspace | ✅ | `backend/` standalone Fastify 5 + TS package |
| `GET /healthz` → `{"ok": true}` | ✅ | unit test + smoke test, verified 200/JSON |
| Smoke test proving it works | ✅ | `scripts/smoke.mjs` real-HTTP, PASS |
| Follows AGENTS.md / conventions | ✅ | mirrors `orchestrator/` (pnpm, NodeNext ESM, strict, dist/, multi-stage Dockerfile) |
| Docs updated where required | ✅ | `backend/README.md`, root README, ADR-001 in `DECISIONS.md` |
| Branch naming + base | ✅ | `backend/TASK-174-...` from `develop`, PR base `develop` |

### Findings

**Blocking:** none.

**Non-blocking (nice-to-have, do not block merge):**

1. `backend/src/config.ts:19` — `port: Number(process.env.BACKEND_PORT ?? ...)`
   accepts `NaN` for a non-numeric value; a typo like `BACKEND_PORT=abc`
   surfaces later as an obscure listen error. Suggest validating with
   `Number.isInteger` (fall back or throw) — optional for a skeleton.
2. `backend/test/healthz.test.ts:16` — the second test is named "HEAD-style
   probing" but sends a plain `GET` again; it duplicates the first test and
   does not actually exercise `HEAD`. Rename it or make it a real `HEAD`
   request.
3. `backend/scripts/smoke.mjs:72` — body comparison uses
   `JSON.stringify(body) === JSON.stringify({ ok: true })`, which is
   key-order sensitive; a deep-equal comparison would be more robust.
   Cosmetic.
4. Repo-wide: no CI workflow exists yet, so the passing suite is only proven
   locally. Consider a GitHub Actions `pnpm check` workflow for `backend/`
   (and the frontend package) — outside this PR's scope but worth tracking.
5. Cross-PR: `DECISIONS.md` is added at the repo root by PR #2 (ADR-001),
   PR #3 (ADR-002/003) and PR #4 (frontend decision), each with a different
   file format. Whichever merges second/third will conflict — reconcile the
   file at merge time (BA's PR already carries a reconciliation note).

### Verdict

**APPROVE** — meets all acceptance criteria; all tests and the smoke test
pass under independent verification; findings are non-blocking.

---

## PR #4 — TASK-175: Frontend app shell with routing

### What was reviewed

Full diff (19 files, +3855, 4 commits) against the TASK-175 acceptance
criteria: scaffold the frontend app shell with routing and a placeholder
home page.

Files reviewed (head `71188db`):

- `frontend/src/main.tsx` — React bootstrap + `BrowserRouter`
- `frontend/src/App.tsx` — route table (pathless `AppLayout` + index + `*`)
- `frontend/src/layouts/AppLayout.tsx` — header/main/footer shell
- `frontend/src/components/{AppHeader,AppFooter}.tsx`
- `frontend/src/pages/{HomePage,NotFoundPage}.tsx`
- `frontend/src/App.test.tsx` — 5 Vitest + Testing Library tests
- `frontend/src/setupTests.ts`, `src/vite-env.d.ts`, `src/index.css`
- `frontend/package.json`, `package-lock.json`, `index.html`,
  `vite.config.ts`, `tsconfig.json`
- `frontend/README.md`, root `README.md`, `DECISIONS.md`

### Independent verification (performed by reviewer)

Checked out the PR head in a clean worktree and ran everything with Node
v24:

```text
$ npm ci                    # ok (committed lockfile; standard esbuild script warning)
$ npm run build             # tsc && vite build — PASS (166.93 kB JS, 2.21 kB CSS)
$ npm test                  # vitest run — 5/5 PASS
$ vite preview --port 5199
  GET /                    -> 200 text/html  <title>agent-team — Frontend</title>
  GET /some/deep/path      -> 200            (SPA fallback serves index.html)
  GET /assets/index-*.js   -> 200 text/javascript
```

All claims in the PR description reproduce: build passes, 5/5 tests pass,
`/` serves the shell, deep links get the SPA fallback, assets load.

### Acceptance-criteria check

| Criterion (TASK-175 / seed) | Met? | Evidence |
|---|---|---|
| Frontend app shell in the workspace | ✅ | `frontend/` self-contained Vite + React + TS app |
| Routing | ✅ | React Router 6 `BrowserRouter`; `/` + `*` 404; pathless layout route |
| Placeholder home page | ✅ | `HomePage` at `/` (verified served via preview) |
| Tests | ✅ | 5/5 Vitest (shell landmarks, active nav, 404, navigation) |
| Docs updated where required | ✅ | `frontend/README.md`, root README, stack decision in `DECISIONS.md` |
| Branch naming + base | ✅ | `frontend/TASK-175-...` from `develop`, PR base `develop` |
| No `.dsh`/`.agent-team`/`node_modules` leakage | ✅ | verified in diff |

### Findings

**Blocking:** none for the skeleton itself.

**Must reconcile before QA (non-blocking for this PR's own criteria, but
important):**

1. **Copy/feature mismatch with `REQUIREMENTS.md` (BA PR #3).** The BA's
   acceptance criteria for the frontend shell were written against the
   *old, unmerged* TASK-002 iteration: US-FE-001 requires heading
   **"Agent Team App"** and placeholder text **"React app shell is
   mounted."**, and US-FE-002 requires an interactive **`#hello-btn`**
   ("Say hello" → "Hello from agent-team"). PR #4 ships a fresh shell with
   heading **"Welcome to agent-team"** (`src/pages/HomePage.tsx:8`) and **no
   hello button** (`grep -ri hello src/` → nothing). The frontend agent
   documented this deliberate re-scope in `DECISIONS.md` (new shell, routing,
   404) — that is the correct process — but **REQUIREMENTS.md was not
   updated to match**. The QA test plan (T3) consumes §3.2 of REQUIREMENTS.md
   and will check for the button/copy that do not exist. Resolution (either):
   - BA updates REQUIREMENTS.md US-FE-001/002 to the shipped shell (heading,
     copy, and no-button or add-button decision), or
   - a follow-up frontend task adds the hello button + copy.
   Must land before QA executes, otherwise the QA plan fails against the
   merged shell.
2. **Shared `DECISIONS.md` triple-add.** PR #2, #3 and #4 each add
   `DECISIONS.md` with different formats (`# Decisions (ADR)` reverse-chron
   vs `# Decisions` append-only). Merge-order conflict is guaranteed for the
   second/third merge; reconcile the file at merge time (append the frontend
   decision into the surviving format).

**Non-blocking nits:**

3. `frontend/package.json` has no `engines` field while
   `frontend/README.md` says "Node.js 18+"; add `engines.node` to make the
   requirement enforceable.
4. No `lint` script / eslint config in `frontend/` (Vite templates usually
   include one) — minor; the repo currently has no lint anywhere.

### Verdict

**APPROVE** — meets the TASK-175 acceptance criteria (app shell + routing +
placeholder home page); build and 5/5 tests pass under independent
verification; no `.dsh`/`.agent-team` leakage; branch naming and base are
correct. The REQUIREMENTS.md copy/hello-button mismatch (finding 1) and the
shared `DECISIONS.md` conflict (finding 2) must be reconciled before the QA
test plan executes — track them so they are not lost at merge time.

---

## Delivery notes

- Verdicts delivered on the PRs themselves (per AGENTS.md / GITHUB WORKFLOW
  SKILL). GitHub hard-rejects `APPROVE`/`REQUEST_CHANGES` events when the
  reviewer is the PR author (all agents share the `maithanhduyan` account);
  where the official event is rejected, the verdict is posted as a review
  whose body states the verdict explicitly.
- Both skeleton branches follow the team model: `<agent>/TASK-<id>-<slug>`
  from `develop`, PR base `develop`, PR titles prefixed `TASK-<id>:`.
