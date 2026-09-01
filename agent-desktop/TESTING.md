# TESTING — T06 full suite: suite-defect fixes + golden regen (TASK-7439 / Redmine #41)

> Task: TASK-7439 / Redmine #41 (T06 suite self-consistency defects + golden regen) · Tester: tester (tester@agent-team.local)
> Project: agent-desktop (subproject of agent-team) · Version: v0.4 Memory Foundation (due 2026-09-25)
> Spec: `docs/memory-spec.md` §13 (acceptance mapping) · Security: `docs/security-review-memory.md` SEC-MEM-01/02
> Branch: `tester/TASK-7439-redmine-41-bug-t06-suite-fix` · Base: `develop`

## 00b. Addendum — T13 GEPA candidate-PR workflow (TASK-9054 / Redmine #48): branch → PR → human review

> Author: backend (backend@agent-team.local) · Date: 2026-09 · Branch:
> `backend/TASK-9054-redmine-48-t13-workflow-skil` · Base: `develop`
> Design: `docs/gepa-pipeline.md` §3.3 D6 / §8 (T09) · Acceptance:
> `docs/skill-evolution-acceptance.md` §6/§7 (T10) · Security:
> `docs/security-review-memory.md` §5 (SEC-GEPA-01…11)

**What this adds:** the candidate → branch → PR → human-review workflow
— `agent-desktop/evolution/workflow/` (see
[`evolution/workflow/README.md`](evolution/workflow/README.md)): per-candidate
dedicated branch (`evolution/<skill>/<run-id>-<candidate>`, BR-1), branch
contains only SKILL.md + dataset version reference + run audit record
(BR-2), PR with the full §6.2 metadata (auto-flagged when missing,
BR-3), 2-approval review gate (owner + cto, SEC-GEPA-06), no auto-merge
path (SEC-GEPA-07), no-hot-swap activation guard (SEC-GEPA-05), and the
run-record ↔ PR audit link (AT-3). It **does not** modify the T06 memory
suite (still 40/40, verified below).

**Test suite** (`npm run test:workflow`): **48/48 pass**

| Area | Tests | What they prove |
|---|---|---|
| size (SEC-GEPA-03) | 4 | ≤ 15 360 bytes fixed; boundary 15360 pass / 15361 reject |
| ab (SEC-GEPA-04) | 3 | A/B base vs candidate: fixture 12/12 fitness 1.0, 0 regressions; dropped-EFS candidate regresses; deterministic (CG-1) |
| activation (SEC-GEPA-05) | 8 | **runtime test:** unmerged candidate is NOT activatable in a live session; merged candidate IS (between sessions); fail-closed empty state; run manifests/candidates are not valid activation inputs |
| review (SEC-GEPA-06/07) | 8 | 2 approvals owner+cto required, < 2 refused (R-7); third-party/CHANGES_REQUESTED don't count; workflow + runner sources have **0 auto-merge hits** (R-8); synthetic merge action detected |
| metadata (§6.2 + auto-flag) | 7 | all §6.2 fields present; guardrail checklist SEC-GEPA-01..11 pass/fail + evidence; cost report without keys; missing metadata block ⇒ auto-flag (BR-3); oversized/failed guardrail ⇒ invalid |
| open-pr (BR-1/BR-2/gates) | 13 | branch name pattern; exactly 3 branch files; non-merge-ready/rejected/oversized/secret candidates REJECTED (no PR); dry-run makes no git/network changes; AT-3 manifest link; github client has no merge endpoint |
| config | 5 | owner/repo parsed from https / token-embedded / ssh remotes; defaults + env overrides |
| T12 integration | 1 | real MockLM run persists candidate SKILL.md (`skill_path`, AT-2); workflow gates the run verdict (merge-ready ⇒ valid plan, else refused) |

**CLI smoke checks (all exit codes verified):**

```bash
npm run evolve:pr -- plan --manifest <run.json> --candidate <id>   # plan (no git/network)
npm run evolve:pr -- size evolution/workflow/test/fixtures/candidates/gen0-01/SKILL.md  # PASS
npm run evolve:pr -- ab <candidate.md>                              # PASS (12/12, 0 regressions)
npm run evolve:pr -- no-auto-merge                                 # PASS (0 hits in src)
npm run evolve:pr -- check-metadata <pr-body.md>                    # PASS (full §6.2 block)
npm run evolve:pr -- check-approvals <reviews.json> --owner <login> --cto <login>
npm run evolve:pr -- activation <registry-state.json> <skill> <sha256>  # merged ⇒ ALLOW, unmerged ⇒ REFUSED
```

**Cross-suite regression (unchanged):** T06 memory suite **40/40** ·
full repo suite **209/209** · T11 dataset builder **27/27** · T14 harness
selfcheck **9/9** · T12 runner **46/46** · T12 sidecar **27/27**
(`test:sidecar` now sets `PYTHONPATH=evolution/sidecar` so the documented
command reproduces the 27 tests).

## 00. Addendum — T14 GEPA eval harness (TASK-8867 / Redmine #45): Mode A 12/12 + planted-failure detection

> Author: tester (tester@agent-team.local) · Date: 2026-09 · Branch:
> `tester/TASK-8867-redmine-45-t14-harness-windo` · Base: `develop`
> Design: `docs/gepa-pipeline.md` §5 (T09) · Acceptance: `docs/skill-evolution-acceptance.md` §4.3/§5 (T10)
> Security: `docs/security-review-memory.md` §5 (SEC-GEPA-01…11)

**What this adds:** the install-dsh eval suite packaged as a GEPA
fitness gate — `agent-desktop/evolution/harness/` (see
[`evolution/harness/README.md`](evolution/harness/README.md)). It does
**not** modify the T06 memory suite (still 40/40, verified below).

**Mode A (offline/CI) — reference run:** all **12/12 cases pass**,
fitness = **1.0**, gate PASS (SEC-GEPA-02):

| Scenario class | Cases | Reference result |
|---|---|---|
| happy-path | hp-install, hp-idempotency, hp-cleanup | ✅ 3/3 |
| efs | efs-detect-target, efs-copy-source, efs-cleanup-encrypted | ✅ 3/3 |
| junction | jct-resolve, jct-traverse, jct-cleanup | ✅ 3/3 |
| service-password | svc-update-credential, svc-restart, svc-failure-safe | ✅ 3/3 |

**Planted-failure detection matrix** (`node mode-a/run-mode-a.mjs --verify-planted`):
each mutant fails **exactly** its scenario class (suite validity proof):

| Mutant | Expected failures | Actual failures | Detected |
|---|---|---|---|
| efs-ignore | efs-detect-target, efs-copy-source, efs-cleanup-encrypted | same | ✅ |
| junction-naive | jct-resolve, jct-traverse, jct-cleanup | same | ✅ |
| svc-no-restart | svc-restart, svc-failure-safe | same | ✅ |

**Harness selfcheck** (`node --test evolution/harness/tests/harness-selfcheck.test.mjs`): **9/9 pass**
(manifest schema + COV-1 coverage, result schema, fitness math ADR-016,
gate threshold, reference 12/12, planted detection, determinism).

**Mode B (owner-run Windows Sandbox):** kit in
`evolution/harness/mode-b/` — `run-mode-b.ps1` (same 12 cases, real
Windows junctions/EFS/file ops, identical result JSON schema),
`owner-instructions.md` (no-code steps), `result-form.md` (fill +
upload). Mode B is the owner's final evidence before merge (T17) and
feeds the T11 dataset builder; the fitness function is shared with
Mode A so owner-uploaded JSON plugs straight into the T12 gate.

**Traceability:** manifest `evolution/harness/manifest.json` v1.0.0
declares the 4 scenario classes + 12 cases; T11 uses it as the coverage
standard (COV-1: class without cases ⇒ dataset invalid).

## 0. Addendum — Redmine #42 backend fix (TASK-7805): suite now 40/40

> Author: backend (backend@agent-team.local) · Date: 2026-09 · Branch:
> `backend/TASK-7805-redmine-42-bug-t04-search-me` · Base: `develop`

The two implementation-side divergences this report filed (F1′, F6) are
**resolved** by the Redmine #42 backend fix. Re-run of the untouched suite
(`node tests/run-suite.mjs`, no assertion/adapter changes):

```text
ℹ tests 40  ℹ pass 40  ℹ fail 0
✔ 00-fixture-selfcheck ................ 17/17
✔ 10-writer (T03) ...................... 9/9   (row 1 now passes)
✔ 20-search (T04) ...................... 5/5   (rows 6/7 now pass)
✔ 30-consolidation (T05) ............... 6/6
```

- **F1′ fixed — `sessions-writer.ts`:** a rejection caused by a missing or
  invalid provenance tag (R-PROV-1) is now audited with
  `content.code: "provenance_missing"` and message
  `write rejected: provenance is mandatory` (fixture `write-attempts.json`
  att-1 pin, spec §13 row 1). All other schema failures keep the generic
  `schema_invalid` code. Unit tests: `test/sessions-writer.test.ts`.
- **F6 fixed — `search-memory.ts`:** the L2 searchable pool is now
  observation-only via the new `isSearchableL2Record` predicate
  (`type === "observation"` **and** non-empty `content.text`). Candidate/
  session_end/rejection/error/quarantine/decay/reflection/supersede/
  graduation/tool_call/hot_promote/session_start/… records never rank and
  no longer displace the golden observation hit set (rank-3 `evt_…0012`
  candidate vs `evt_…0015` observation). Unit tests:
  `test/search-memory.test.ts`. Spec §7.1 + §13 and ADR-005 addendum
  (Redmine #42) pin the observation-only pool; non-observation records stay
  queryable via `grep_logs`.
- No T06 fixture/suite/golden change was needed — the golden was already
  generated on the observation-only pool.

## 1. Summary

| Metric | Value |
|---|---|
| Suite | `agent-desktop/tests/run-suite.mjs` (Node built-in `node:test`, zero runtime deps; tsx dev-dep for .ts imports) |
| Run date | 2026-09-01 (UTC) |
| Node | v24.20.0 |
| **PASS** | **35 / 40** (branch rebased on `develop` 7b22f2b — includes backend fix PRs #24/#25/#26) |
| **FAIL** | **5 / 40** — 2 sub-tests + 2 wrapper suites; every failure has a concrete root cause + evidence in §5 |
| **SKIP** | **0 / 40** — the T03/T04/T05 suites RUN against the merged implementation (TASK-7174 / Redmine #35) |
| Result | ⚠️ **2 divergence groups remain, both implementation-side** — **F1′** (T03 audit `content.code` = generic `schema_invalid` vs pinned `provenance_missing`, decision #38) and **F6** (T04 searchable-L2 pool includes non-observation records vs the T06-pinned observation-only contract, filed as Redmine #42). **No T06-suite defect remains**: the 3 self-consistency defects from Redmine #41 (D1 row-1 count, D2 row-6/7 params vs golden, D3 R-MEM-1 order) are fixed here, and the golden is regenerated for the L3 recency pin (#40). The prior implementation divergences F2 (parse) / F4 (hot facts) / F5 (recency) are resolved by backend PRs #24/#25/#26 now on `develop`. |

**What this run changed vs the previous re-run (TASK-7203, 32 PASS / 8 FAIL):**

1. **D1 — row-1 count assertion fixed** (`tests/10-writer.test.mjs`): the
   suite now asserts `after === before + 1` — a rejected write leaves no
   partial line but an `error` audit record IS appended (spec §13 row 1 /
   fixture att-1). Previously it asserted `after === before`, which
   contradicted the very next assertion that the last line is the error
   record. (Redmine #41 D1.)
2. **D2 — row-6/7 call params aligned to the golden** (`tests/20-search.test.mjs`):
   the calls no longer force `top_k: 50, min_score: 0`; they pass exactly
   the golden case's params so the defaults (`minScoreDefault: 0.1`,
   `topKDefault: 10` — golden meta) apply on both sides. Previously the
   call params and the golden generation params disagreed, so any correct
   implementation returned 39 hits vs the golden's 10. (Redmine #41 D2.)
3. **D3 — R-MEM-1 order assertion fixed** (`tests/10-writer.test.mjs`):
   `readAll` order is now asserted by **file/append order (id sequence,
   archives asc + current)** instead of `ts` order — the shipped corpus is
   deliberately NOT ts-sorted (7 out-of-order positions), and `readAll`
   returns file order per spec §5.5. The wrong "R-MEM-1" label was dropped
   (spec R-MEM-1 = "live sessions write only to L2", §8.1). (Redmine #41 D3.)
4. **Golden regenerated for the L3 recency pin** (`tests/lib/generate-golden.mjs` +
   `tests/fixtures/golden-search.json`): L3 recency is now anchored on
   `fact.last_observed` (Redmine #40 / TASK-7438 / ADR-005 addendum) —
   matching the T04 implementation (`search-memory.ts` `l3Candidate`), so
   the golden and the implementation agree on the anchor (meta
   `l3RecencyAnchor: "last_observed"`; the fixture selfcheck re-derives the
   golden within 1e-6).

## 2. Deliverables

| Deliverable | Path | Content |
|---|---|---|
| Suite | `agent-desktop/tests/*.test.mjs` | 4 files mapped 1:1 to spec §13 — assertions are the spec contract; only the 3 defects documented in Redmine #41 were corrected (row-1 count, row-6/7 params, R-MEM-1 order) |
| Golden | `agent-desktop/tests/fixtures/golden-search.json` | **regenerated** — L3 recency anchor `last_observed` (Redmine #40 pin); `grep-golden.json` unchanged |
| Test-oracle lib | `agent-desktop/tests/lib/generate-golden.mjs` | L3 recency anchor + meta `l3RecencyAnchor` (Redmine #40 / ADR-005 addendum) |
| Fixture README | `agent-desktop/tests/fixtures/README.md` | pinned-contract note: L3 recency anchor = `last_observed` (#40) |
| Adapter lib | `agent-desktop/tests/lib/adapters.mjs` | unchanged by this task (from TASK-7203; normalizes TS exports onto the contract surface) |
| Harness | `agent-desktop/tests/lib/harness.mjs` | unchanged by this task (from TASK-7203) |
| Runner | `agent-desktop/tests/run-suite.mjs` | unchanged by this task (from TASK-7203; injects the tsx loader) |

## 3. Test plan — acceptance-criteria mapping (spec §13), actual results

| # | Spec § | Acceptance criterion | Fixture (00) | T03 (10) | T04 (20) | T05 (30) |
|---|---|---|---|---|---|---|
| 1 | §4.3/§10.1 | Write without provenance → rejected; quarantine/error record | ✅ | ⚠️ see F1′ | — | — |
| 2 | §5.2 | Every `sessions.jsonl` line validates (mandatory fields) | ✅ | ✅ | — | — |
| 3 | §5.5 | Rotation transparent across current + archives | ✅ | ✅ | — | — |
| 4 | §6.2 | `core.md` parses to fact blocks; missing key → error | ✅ | ✅ (backend #38 fix in PR #24) | — | — |
| 5 | §6.3 | Hot facts injected; count ≤ `MEMORY_HOT_MAX` | ✅ | — | ✅ (backend #39 fix in PR #25) | — |
| 6 | §7.1 | Retrieval formula matches golden within 1e-6 | ✅ | — | ⚠️ see F6 | — |
| 7 | §7.1 | include_expired/provenance/since/session_id/top_k/min_score filters | ✅ | — | ⚠️ see F6 | — |
| 8 | §7.2 | `grep_logs` exact lines + context; RE2; limit cap | ✅ | — | ✅ | — |
| 9 | §8.3 | Reflection `{context, error, fix}` | ✅ | — | — | ✅ |
| 10 | §8.4 | Graduation N=3–5 + judge; N<3 → no write + rejection | ✅ | — | — | ✅ |
| 11 | §9.3 | Verdict JSON validates; malformed → per-model error | ✅ | — | — | ✅ |
| 12 | §9.5 | Cap → auto-disable; all capped → pause (mock providers) | ✅ | — | — | ✅ |
| 13 | §10.2 | Injection pattern → quarantine, never L3/L4 | ✅ | ✅ | — | — |
| 14 | §10.3 | Conflict → supersede (old `valid_to` + `supersede` + new block), no overwrite | ✅ | — | — | ✅ |
| 15 | §10.4 | Day-30: importance halved + `decay` record; stale ~60 d | ✅ | — | — | ✅ |
| + | SEC-MEM-01 | Every memory render wrapped in `[MEMORY_START]…[/MEMORY_END]` + data-not-instructions | ✅ | ✅ | ✅ | — |

✅ = pass · ⚠️ = fail with root cause in §5 · — = not covered by that file.

## 4. Actual run output (2026-09-01, node v24.20.0, branch rebased on `develop` 7b22f2b)

```text
ℹ tests 40
ℹ pass 35
ℹ fail 5
ℹ cancelled 0
ℹ skipped 0

✔ 00-fixture-selfcheck ................ 17/17
✔ 30-consolidation (T05) ............... 6/6  (reflection, graduation, judge gate,
                                               verdicts, conflict supersede, decay)
✔ 10-writer (T03) ...................... 8/9
✖    §4.3/§10.1 row 1  — write without provenance (F1′: audit content.code)
✔ 20-search (T04) ...................... 3/5
✖    §7.1 row 6         — golden set 1e-6 (F6: searchable-L2 pool)
✖    §7.1 row 7         — filters (F6: searchable-L2 pool)
```

Re-run: `cd agent-desktop && node tests/run-suite.mjs` (needs `npm ci` once — installs `tsx`, a declared devDependency).

**Note on the base:** this branch was rebased onto `develop` 7b22f2b, which
already contains backend fix PRs #24 (TASK-7436/#38 parseCoreMd), #25
(TASK-7437/#39 hot-fact decay) and #26 (TASK-7438/#40 spec pin). Rows 4 and 5
(which failed in the TASK-7203 re-run) now **pass**. The remaining 5 failures
are exactly **F1′ (audit `content.code`)** and **F6 (searchable-L2 pool)** plus
their 2 wrapper suites (see §5). **No T06-suite defect remains.**

## 5. Failure analysis (expected vs actual, evidence)

### F1′ — T03 row 1: count fixed; audit `content.code` = `schema_invalid` vs pinned `provenance_missing` (backend alignment)
The T06-suite defect from Redmine #41 D1 (the self-contradictory
`after === before` count assertion) is **fixed**: the suite now asserts
`after === before + 1` and the count assertion passes (T03 `SessionsWriter`
appends the audit line: 28 → 29). What remains is the secondary note from #41
D1: the audit record's `content.code` is the generic `schema_invalid` (T03,
`sessions-writer.ts:153`), while the T06 fixture pins the specific
`provenance_missing` (Redmine #38 decision — the pinned code string is
`provenance_missing`; the fixture and the suite assertion already carry it).
- Expected (fixture `write-attempts.json` att-1, decision #38):
  `content.code === "provenance_missing"`.
- Actual (T03): `content.code === "schema_invalid"`.
- Verdict: **T03 implementation divergence** — the writer must emit the
  R-PROV-1-specific code `provenance_missing` for a missing-provenance
  rejection. Suite side already pinned to the decision; the writer alignment
  is a backend item (noted on Redmine #38).

### F-ORD — T03 readAll order (R-MEM-1) — FIXED (Redmine #41 D3)
`10-writer.test.mjs` now asserts `readAll` returns records in **file/append
order by id** (archives asc + current file), which is the spec §5.5
"rotation transparent" behavior the implementation implements. The previous
ts-order assertion was invalid for the shipped corpus (deliberately not
ts-sorted). The wrong "R-MEM-1" label (spec R-MEM-1 = "live sessions write
only to L2", §8.1) was removed. **Passes in this run.**

### F2 — T03 row 4: core-broken.md parse error — FIXED by backend PR #24 (Redmine #38)
`parseCoreMd` now raises `FactBlockError` on malformed blocks (bad id or
missing key) instead of silently dropping them — merged to `develop` via PR
#24 (TASK-7436 / Redmine #38). **Passes in this run.**

### F3 — T04 rows 6/7: call params vs golden params — FIXED (Redmine #41 D2)
The test no longer forces `top_k: 50, min_score: 0`; the call params now
equal the golden generation params (defaults `minScoreDefault 0.1`,
`topKDefault 10`), so the golden hit-set comparison is meaningful. With
params aligned, rows 6/7 fail only on the remaining searchable-L2 pool
divergence (F6) — see below.

### F4 — T04 row 5: hot-fact selection — FIXED by backend PR #25 (Redmine #39)
`loadHotFacts` now applies the §10.4 Day-30 decay projection before hot-fact
selection (contract (a) chosen in #39; ADR-019 updated) — merged to `develop`
via PR #25 (TASK-7437). The row-5 `MEMORY_HOT_MAX` cap case also now
exercises `core-hot-max.md` (adapter stages a non-`core.md` fixture; ids
renumbered to spec-valid `fact_<n>`). **Passes in this run.**

### F5 — T04 rows 6/7: L3 recency anchor — FIXED by golden regen (Redmine #40 pin)
`generate-golden.mjs` computed L3 recency from `fact.valid_from` while the
T04 implementation (`search-memory.ts` `l3Candidate`) uses
`fact.last_observed`; facts with `valid_from ≠ last_observed`
(fact_0001/0002/0009) scored differently and the 1e-6 golden assertion
could not hold. Per Redmine #40 (TASK-7438) the spec is pinned to
**L3 recency = `last_observed`** (ADR-005 addendum, spec §7.1 updated) and
the golden is now regenerated with that anchor — the implementation and the
golden agree. The fixture selfcheck re-derives the golden within 1e-6
(**passes in this run**). With params aligned, the L3 scores now match; rows
6/7 fail only on the searchable-L2 pool divergence (F6).

### F6 — T04 rows 6/7: searchable-L2 pool divergence (NEW — found in this run, filed as Redmine #42)
With the params fixed (F3) and the recency anchor aligned (F5), rows 6/7
still fail at **rank 3** because the T04 implementation's searchable L2
pool is **wider than the T06-pinned contract**:
- T06 pinned contract (fixtures/README): searchable L2 = `type:
  observation` records with `content.text`; "other record types have no
  rankable text and are excluded from `search_memory` results".
- T04 actual (`search-memory.ts` `l2Candidate`/`l2Text` + `recordText`
  fallback in `injection.ts`): **every** L2 record that passes the
  active/filter gates is scored — including `candidate`, `session_end`,
  `rejection`, `session_start`, `hot_promote`, `error`, `quarantine`,
  `decay`, `reflection`, `supersede`, `graduation`, `tool_call` — with
  `content.text` when present, else all content strings joined.

Evidence (query `user prefers vietnamese chat messages`, top_k 10,
min_score 0.1, REF_NOW):
```text
default: impl rank 3 = evt_a1b2c3d4e5f60012 (candidate) 0.532527
                   vs golden rank 3 = evt_a1b2c3d4e5f60015 0.526964
impl-only in top-10: evt_…0012 (candidate), evt_…0011 (candidate), evt_…0027 (session_end)
golden-only in top-10: evt_…0024, fact_0009, evt_…0005
includeExpired: impl[4] = evt_…0012 (candidate) 0.532527 vs golden[4] = evt_…0015
```
- Expected (pinned contract): only `observation` records with
  `content.text` are ranked.
- Actual (T04): all records are ranked; non-observation records displace
  the pinned hit set.
- Verdict: **NEW implementation divergence** (T04 searchable-L2 pool vs
  the T06-pinned contract) — needs a product decision: align the
  implementation to the pinned pool, or re-pin the contract to "any record
  with rankable text". Filed as Redmine #42 with this evidence.

## 6. Findings & adapter normalizations (visible to T07 review)

The suite ASSERTIONS are the spec contract; this run only corrected the 3
self-consistency defects documented in Redmine #41. The adapter layer
(`tests/lib/adapters.mjs`, from TASK-7203) normalizes the merged
implementation onto the pinned contract surface:

1. **T03 `SessionsWriter.append`** returns `{status: 'written'|'quarantined'|'rejected', …}`; the adapter adds the boolean `ok` mirror the suite asserts. Rejection/quarantine records ARE appended (spec §13 row 1) — the count assertion now checks `before + 1` (F1 fixed). The audit `content.code` `schema_invalid` vs pinned `provenance_missing` remains a backend alignment item (F1′).
2. **T03 `SessionsWriter.readAll`** returns `{records, skipped}`; the adapter exposes `records`. Order is file order (archives asc + current) — asserted by id sequence now (F-ORD fixed).
3. **T03 `parseCoreMd`** returns `{header, facts}` with typed fields (`hot: boolean`, `valid_to: null`); the adapter maps facts to the T06-oracle shape (`hot: "true"|"false"`, `valid_to: ""` for open) so `tests/lib/schema.mjs validateFactBlock` passes. Row-4 parse-error behavior fixed by backend PR #24 (#38).
4. **SEC-MEM-01 render format divergence (T03/T04):** the implementation's `renderHotFacts/renderSearchResults/renderGrepMatches` emit a different item format (`- [hot] id (provenance: …, importance: …): text`) and `wrapMemoryBlock` prefixes the note with `# `. The T06-pinned format (`render-samples.json`) is `- [L3 id] importance=… provenance=… | text` with the bare note line. The adapter composes the **pinned** envelope/item lines from the implementation's own constants (`MEMORY_START`, `DATA_NOT_INSTRUCTIONS_NOTE`, `MEMORY_END`). The implementation's format differs from the pinned SEC-MEM-01 sample — worth aligning (note on #38/#40).
5. **T04 `searchMemory(memoryDir, params, options)`**: the adapter forwards `memoryDir` from the suite's `opts` and pins the contract constants (α=0.5/β=0.3/γ=0.2, half-life 30 d, `now = CONTRACT.refNow`) — the impl exposes these as injectable options for determinism (spec §7.1). The searchable-L2 pool divergence (F6) is NOT normalized by the adapter — it changes the result set, not the call shape, and is filed for a product decision (#42).
6. **T04 `grepLogs(memoryDir, params, {runsDir})`**: the adapter forwards `memoryDir`/`runsDir`, prefixes match files with `memory/`, and enforces the **pinned file order** (sessions.jsonl → archives asc → core.md) before applying `limit`. The implementation iterates archives first (chronological read order); the match SET is identical, only order/limit-slice differ. `invalid regex`/`no match`/context/RE2 behavior verified green.
7. **T04 `loadHotFacts(memoryDir, options)`**: the adapter maps the suite's `core.md` path → `dirname`, and `env.MEMORY_HOT_*` → `minImportance`/`max`, pinned `now`. Selection now applies the §10.4 Day-30 decay projection (backend #39 — `projectDay30Decay`); for a non-`core.md` fixture path the adapter stages the file as `core.md` in a temp dir (F4 fixed).
8. **T05 `consolidation.ts`** exposes its helpers directly in the T06 adapter shapes (`judge`, `runConsolidation`, `applyConflict`, `applyDecay`, `reflect`, `validateVerdict`, `resolvePanel` — the module doc states they are "the T06 adapter surface"); the adapter maps them 1:1. **Suite fully green.**
9. **T03 writer clock:** the adapter pins `SessionsWriter` `now` to `CONTRACT.refNow` so audit records appended during the suite carry the corpus's reference instant (deterministic; without it the real wall clock can land mid-corpus).
10. **Golden recency anchor (this run):** `generate-golden.mjs` now anchors L3 recency on `fact.last_observed` per Redmine #40 (ADR-005 addendum) — meta `l3RecencyAnchor: "last_observed"`; the fixture selfcheck re-derives the golden within 1e-6.

## 7. Traceability

| Artifact | Reference |
|---|---|
| Task | TASK-7439 / Redmine #41 (T06 suite defects + golden regen); prior runs TASK-7203 (#32), TASK-6652 |
| Spec | `docs/memory-spec.md` §13 + §4–§11; §7.1 recency anchor pinned to `last_observed` by Redmine #40 / ADR-005 addendum |
| Security | `docs/security-review-memory.md` SEC-MEM-01/02, SEC-KEY/COST/LOG |
| Implementation | T03/T04/T05/T08 merged on `develop` via PRs #14–#17 (TASK-7174 / Redmine #35); backend fix wave PRs #24/#25/#26 merged |
| Suite defects fixed | Redmine #41 (D1 row-1 count, D2 row-6/7 params vs golden, D3 R-MEM-1 order) — this branch |
| Golden regen | Redmine #40 / TASK-7438 pin (L3 recency = `last_observed`) — this branch |
| Backend fixes merged | Redmine #38 (T03 parse, F2 — PR #24), #39 (T04 hot facts, F4 — PR #25), #40 (spec pin — PR #26) |
| New divergences (this run) | T04 searchable-L2 pool (F6 — Redmine #42, open), T03 audit `content.code` (F1′ — noted on #38) |
| Backend fix (after this run) | Redmine #42 / TASK-7805 resolves F1′ (audit code `provenance_missing`) and F6 (observation-only L2 pool) — suite re-run 40/40 (see §0 addendum) |
| Input to | T07 [reviewer] #33 — matrix comparison uses this run's PASS/FAIL per §13 row |
