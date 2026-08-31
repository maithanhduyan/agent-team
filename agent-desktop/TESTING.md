# TESTING — T06 full suite re-run against merged T03/T04/T05 (v0.4 Memory Foundation)

> Task: TASK-7203 / Redmine #32 (T06 re-run) · Tester: tester (tester@agent-team.local)
> Project: agent-desktop (subproject of agent-team) · Version: v0.4 Memory Foundation (due 2026-09-25)
> Spec: `docs/memory-spec.md` §13 (acceptance mapping) · Security: `docs/security-review-memory.md` SEC-MEM-01/02
> Branch: `tester/TASK-7203-redmine-32-t06-re-run-full-s` · Base: `develop`

## 1. Summary

| Metric | Value |
|---|---|
| Suite | `agent-desktop/tests/run-suite.mjs` (Node built-in `node:test`, zero runtime deps; tsx dev-dep for .ts imports) |
| Run date | 2026-08-31 (UTC) |
| Node | v24.20.0 |
| **PASS** | **32 / 40** |
| **FAIL** | **8 / 40** (6 sub-tests + the 2 wrapper suites; every failure below has a concrete root cause + evidence) |
| **SKIP** | **0 / 40** — the T03/T04/T05 suites now **RUN** against the merged implementation (TASK-7174 / Redmine #35) |
| Result | ⚠️ **suite not fully green** — 3 implementation-contract divergences (T03 parse error, T04 search recency anchor, T04 hot-fact decay) and 3 T06-suite self-consistency defects (row 1 count, row 6/7 min_score vs golden, R-MEM-1 corpus order). All are documented in §5 with evidence; implementation divergences filed on Redmine (#38/#39/#40), suite defects on #41. T05 consolidation suite is fully green. |

**What changed vs the previous run (2026-09-01, 17 PASS / 3 SKIP):**
- `tests/lib/harness.mjs` — `IMPL_CANDIDATES` now probes the TypeScript
  implementation: primary candidate `src/index.ts` (the T03/T04/T05 public
  API, see its export list) plus task-specific `.ts` modules and the legacy
  `.mjs/.js` paths as fallbacks.
- `tests/lib/adapters.mjs` — maps the **actual exports** of
  `agent-desktop/src/index.ts` onto the contract surface the suites
  assert (see §6 for the normalizations; the suite ASSERTIONS are the
  spec contract and were **not** changed).
- `tests/run-suite.mjs` — resolves `tsx` from the project dependency tree
  and forwards it via `--import` (the `.ts` sources import each other with
  `./x.js` specifiers; Node's native type stripping does not rewrite
  them). Without tsx the suites degrade to SKIP, not crash.

## 2. Deliverables

| Deliverable | Path | Content |
|---|---|---|
| Fixture pack | `agent-desktop/tests/fixtures/` | unchanged from TASK-6652 — memory corpus, golden sets, verdicts, mock providers, decay/conflict/graduation cases, injection patterns, SEC-MEM-01 render samples (catalog in `fixtures/README.md`) |
| Suite | `agent-desktop/tests/*.test.mjs` | 4 files mapped 1:1 to spec §13 (unchanged — assertions are the contract) |
| Runner | `agent-desktop/tests/run-suite.mjs` | `cd agent-desktop && node tests/run-suite.mjs` — now injects the tsx loader |
| Adapter lib | `agent-desktop/tests/lib/adapters.mjs` | maps the merged TS exports (T03/T04/T05) onto the suite contract surface |
| Harness | `agent-desktop/tests/lib/harness.mjs` | `.ts` probe paths added |
| Test-oracle lib | `agent-desktop/tests/lib/schema.mjs`, `generate-golden.mjs` | unchanged (spec oracle + golden math) |

## 3. Test plan — acceptance-criteria mapping (spec §13), actual results

| # | Spec § | Acceptance criterion | Fixture (00) | T03 (10) | T04 (20) | T05 (30) |
|---|---|---|---|---|---|---|
| 1 | §4.3/§10.1 | Write without provenance → rejected; quarantine/error record | ✅ | ⚠️ see F1 | — | — |
| 2 | §5.2 | Every `sessions.jsonl` line validates (mandatory fields) | ✅ | ✅ | — | — |
| 3 | §5.5 | Rotation transparent across current + archives | ✅ | ✅ | — | — |
| 4 | §6.2 | `core.md` parses to fact blocks; missing key → error | ✅ | ⚠️ see F2 | — | — |
| 5 | §6.3 | Hot facts injected; count ≤ `MEMORY_HOT_MAX` | ✅ | — | ⚠️ see F4 | — |
| 6 | §7.1 | Retrieval formula matches golden within 1e-6 | ✅ | — | ⚠️ see F3+F5 | — |
| 7 | §7.1 | include_expired/provenance/since/session_id/top_k/min_score filters | ✅ | — | ⚠️ see F3 | — |
| 8 | §7.2 | `grep_logs` exact lines + context; RE2; limit cap | ✅ | — | ✅ | — |
| 9 | §8.3 | Reflection `{context, error, fix}` | ✅ | — | — | ✅ |
| 10 | §8.4 | Graduation N=3–5 + judge; N<3 → no write + rejection | ✅ | — | — | ✅ |
| 11 | §9.3 | Verdict JSON validates; malformed → per-model error | ✅ | — | — | ✅ |
| 12 | §9.5 | Cap → auto-disable; all capped → pause (mock providers) | ✅ | — | — | ✅ |
| 13 | §10.2 | Injection pattern → quarantine, never L3/L4 | ✅ | ✅ | — | — |
| 14 | §10.3 | Conflict → supersede (old `valid_to` + `supersede` + new block), no overwrite | ✅ | — | — | ✅ |
| 15 | §10.4 | Day-30: importance halved + `decay` record; stale ~60 d | ✅ | — | — | ✅ |
| + | SEC-MEM-01 | Every memory render wrapped in `[MEMORY_START]…[/MEMORY_END]` + data-not-instructions | ✅ | ✅ | ✅ | — |

✅ = pass · ⚠️ = fail with root cause in §5 (F1…F5) · — = not covered by that file.

## 4. Actual run output (2026-08-31, node v24.20.0)

```text
ℹ tests 40
ℹ pass 32
ℹ fail 8
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms ~720

✔ 00-fixture-selfcheck ................ 17/17
✔ 30-consolidation (T05) ............... 6/6  (reflection, graduation, judge gate,
                                               verdicts, conflict supersede, decay)
✔ 10-writer (T03) ...................... 6/9
✖    §4.3/§10.1 row 1  — write without provenance (F1)
✖    §6.2 row 4         — core-broken.md parse error (F2)
✖    R-MEM-1            — readAll append order (F-ORD)
✔ 20-search (T04) ...................... 2/5
✖    §7.1 row 6         — golden set 1e-6 (F3 + F5)
✖    §7.1 row 7         — filters (F3)
✖    §6.3 row 5         — hot facts (F4)
```

Re-run: `cd agent-desktop && node tests/run-suite.mjs` (needs `npm ci` once — installs `tsx`, a declared devDependency).

## 5. Failure analysis (expected vs actual, evidence)

### F1 — T03 row 1: "no partial line appended" contradicts the spec it asserts
`10-writer.test.mjs:43` asserts `after === before` ("no partial line appended")
while the very next lines (44–47) assert the last line IS the error record —
the spec (§13 row 1) and the fixture (`write-attempts.json` att-1) require
**an error record to be written**, i.e. `after === before + 1`.
- Expected (spec §13 row 1): rejected write + one `error` audit line appended.
- Actual (T03 `SessionsWriter`): `status:'rejected'` + audit line appended —
  **spec-correct**; line count 28 → 29, so the test's count assertion fails.
- Secondary: the audit's `content.code` is the generic `schema_invalid`
  (T03), the fixture pins the specific `provenance_missing`.
- Verdict: **T06-suite defect** (self-contradictory assertion) — filed #41.
  The implementation behavior is spec-compliant; the pinned code string
  (`provenance_missing` vs `schema_invalid`) is a product decision (see
  #38 note).

### F2 — T03 row 4: core-broken.md does not raise a parse error
`10-writer.test.mjs:118` expects `parseCoreMd(core-broken.md)` to reject
(`/statement|parse/i`). `core-broken.md` uses id `fact_b0001` (missing
`statement`). T03's `parseCoreMd` recognizes blocks only by
`<!-- fact_\d+ -->` / `## fact_\d+: …` markers (`\d+` = digits only, spec
§4.2 id format); `fact_b0001` does not match, so the block is **silently
skipped** and the file parses to **0 facts with no error**.
- Expected: missing required key → parse error (row 4 / §6.2).
- Actual: silent drop → no error; the corpus's own `factBlock` oracle
  (`\w+`) DOES parse the broken block and flags it invalid.
- Verdict: **T03 divergence** — a malformed block (bad id or missing key)
  is silently discarded instead of raising `FactBlockError` (silent data
  loss is a real availability concern, spec §11) — filed #38.

### F-ORD — T03 R-MEM-1: "readAll returns records in append order"
`10-writer.test.mjs:144` asserts the returned records' `ts` are sorted.
The shipped corpus `tests/fixtures/memory/sessions.jsonl` is **not** in
`ts` order — 7 positions are out of order (lines 3, 4, 6, 13, 18, 25, 28,
e.g. line 28 `hot_promote` 2026-08-30T11:00 after line 27 `session_end`
2026-08-31T23:59). T03's `readAll` returns **file order** (archives asc +
current), which is the spec's "rotation transparent" behavior (§5.5); the
assertion's ts-order proxy does not hold for the fixture. Also, the
"R-MEM-1" tag is a mislabel — spec R-MEM-1 is "live sessions write only to
L2" (§8.1), not a read-order rule.
- Verdict: **T06-suite/fixture defect** — filed #41 (needs a decision:
  re-order the corpus, or assert file order instead of ts order).

### F3 — T04 rows 6/7: test passes `min_score: 0` but compares to a golden generated with `min_score: 0.1`
`20-search.test.mjs:35` calls `searchMemory({…, top_k: 50, min_score: 0})`
(and :54 for filters) but compares against `golden-search.json`
`default.expected` / filter cases generated by `generate-golden.mjs` with
`minScoreDefault: 0.1`, `topKDefault: 10` (meta pinned in the file).
- Expected (test's own params): 39 hits at `min_score: 0`.
- Expected (golden): 10 hits.
- Actual: T04 correctly returns 39 (`same hit set — 39 !== 10`); filters
  `includeExpired` returns 42 vs golden 10.
- Verdict: **T06-suite/golden defect** — the call params and the golden
  generation params disagree. Filed #41. With params aligned
  (`top_k:10, min_score:0.1`) the impl returns the golden's hit set, and
  the remaining score drift is F5.

### F4 — T04 row 5: hot-fact selection does not apply the Day-30 decay projection
`20-search.test.mjs:89` expects `['fact_0001','fact_0002','fact_0003']`
(the T06-pinned post-decay projection at REF_NOW: `fact_0005` is hot in
the pre-consolidation fixture but decayed 0.9 → 0.225/stale, so excluded).
T04 `loadHotFacts` reads `core.md` as-is: `fact_0005` (hot, active, 0.9)
is still injected →
`['fact_0001','fact_0005','fact_0002','fact_0003']`.
- Expected: decayed/demoted facts are excluded before injection (§10.4
  projection, T06-pinned in `00-fixture-selfcheck`).
- Actual: injection happens on the raw file; the decay pass is T05's job
  (`runConsolidationJob`), so a session start before the first
  consolidation sees stale facts.
- Verdict: **contract split divergence** (T04 `loadHotFacts` vs the
  T06-pinned post-decay projection) — filed #39; product decision: run
  decay before session start, or apply the projection in `loadHotFacts`.

### F5 — T04 rows 6/7: L3 recency anchored on `last_observed`, golden pinned `valid_from`
With aligned params (`top_k:10, min_score:0.1`) T04 returns the golden hit
set but the ranking diverges from rank 3 (evidence, 2026-08-31):

```text
rank 0 evt_a1b2c3d4e5f60002 impl=0.837143 golden=0.837143 OK
rank 1 evt_a1b2c3d4e5f60003 impl=0.623333 golden=0.623333 OK
rank 2 evt_a1b2c3d4e5f60013 impl=0.536615 golden=0.536615 OK
rank 3 evt_a1b2c3d4e5f60012 impl=0.532527 golden=0.526964 (golden: evt_…0015)
rank 6 fact_0001       impl=0.522009 golden=0.448704
rank 7 fact_0002       impl=0.504122 golden=0.439910 (golden: fact_0009)
```

T06 golden `generate-golden.mjs` computes L3 recency from
`fact.valid_from`; T04 `search-memory.ts` (`l3Candidate`) uses
`fact.last_observed`. Facts whose `valid_from ≠ last_observed`
(fact_0001/0002/0009 in the fixture) score differently → the 1e-6 golden
assertion cannot hold. Spec §7.1 says "recency on `record.ts`" without
disambiguating for L3.
- Verdict: **spec ambiguity pinned by T06, diverged by T04** — filed #40.

## 6. Findings & adapter normalizations (visible to T07 review)

The suite ASSERTIONS were kept unchanged; the adapter layer
(`tests/lib/adapters.mjs`) normalizes the merged implementation onto the
pinned contract surface:

1. **T03 `SessionsWriter.append`** returns `{status: 'written'|'quarantined'|'rejected', …}`; the adapter adds the boolean `ok` mirror the suite asserts. Rejection/quarantine records ARE appended (spec §13 row 1) — see F1.
2. **T03 `SessionsWriter.readAll`** returns `{records, skipped}`; the adapter exposes `records`. Order is file order (archives asc + current) — see F-ORD.
3. **T03 `parseCoreMd`** returns `{header, facts}` with typed fields (`hot: boolean`, `valid_to: null`); the adapter maps facts to the T06-oracle shape (`hot: "true"|"false"`, `valid_to: ""` for open) so `tests/lib/schema.mjs validateFactBlock` passes.
4. **SEC-MEM-01 render format divergence (T03/T04):** the implementation's `renderHotFacts/renderSearchResults/renderGrepMatches` emit a different item format (`- [hot] id (provenance: …, importance: …): text`) and `wrapMemoryBlock` prefixes the note with `# `. The T06-pinned format (`render-samples.json`) is `- [L3 id] importance=… provenance=… | text` with the bare note line. The adapter composes the **pinned** envelope/item lines from the implementation's own constants (`MEMORY_START`, `DATA_NOT_INSTRUCTIONS_NOTE`, `MEMORY_END`). The implementation's format differs from the pinned SEC-MEM-01 sample — worth aligning (filed as a note on #38/#40).
5. **T04 `searchMemory(memoryDir, params, options)`**: the adapter forwards `memoryDir` from the suite's `opts` and pins the contract constants (α=0.5/β=0.3/γ=0.2, half-life 30 d, `now = CONTRACT.refNow`) — the impl exposes these as injectable options for determinism (spec §7.1).
6. **T04 `grepLogs(memoryDir, params, {runsDir})`**: the adapter forwards `memoryDir`/`runsDir`, prefixes match files with `memory/`, and enforces the **pinned file order** (sessions.jsonl → archives asc → core.md) before applying `limit`. The implementation iterates archives first (chronological read order); the match SET is identical, only order/limit-slice differ. `invalid regex`/`no match`/context/RE2 behavior verified green.
7. **T04 `loadHotFacts(memoryDir, options)`**: the adapter maps the suite's `core.md` path → `dirname`, and `env.MEMORY_HOT_*` → `minImportance`/`max`, pinned `now`. Selection divergence (no decay projection) is F4.
8. **T05 `consolidation.ts`** exposes its helpers directly in the T06 adapter shapes (`judge`, `runConsolidation`, `applyConflict`, `applyDecay`, `reflect`, `validateVerdict`, `resolvePanel` — the module doc states they are "the T06 adapter surface"); the adapter maps them 1:1. **Suite fully green.**
9. **T03 writer clock:** the adapter pins `SessionsWriter` `now` to `CONTRACT.refNow` so audit records appended during the suite carry the corpus's reference instant (deterministic; without it the real wall clock can land mid-corpus).
10. **No Redmine bugs filed before this run for T03–T05** — all implementation divergences found in this re-run are new: #38 (F2), #39 (F4), #40 (F5). T06-suite defects: #41 (F1, F-ORD, F3).

## 7. Traceability

| Artifact | Reference |
|---|---|
| Task | TASK-7203 / Redmine #32 (T06 re-run); prior TASK-6652 |
| Spec | `docs/memory-spec.md` §13 + §4–§11 |
| Security | `docs/security-review-memory.md` SEC-MEM-01/02, SEC-KEY/COST/LOG |
| Implementation | T03/T04/T05/T08 merged on `develop` via PRs #14–#17 (TASK-7174 / Redmine #35) |
| Suite defects | Redmine #41 (F1, F-ORD, F3 — T06 deliverables) |
| Implementation divergences | Redmine #38 (T03 parse, F2), #39 (T04 hot facts, F4), #40 (T04 search recency, F5) |
| Input to | T07 [reviewer] #33 — matrix comparison uses this run's PASS/FAIL per §13 row |
