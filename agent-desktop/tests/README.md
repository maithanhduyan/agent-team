# T06 Memory test suite — how to run

> Task: TASK-6652 / Redmine #32 (T06) · Owner: tester (tester@agent-team.local)

## Prerequisites

- Node.js ≥ 18 (built-in `node:test` runner; no npm install needed).
- The fixture pack under `tests/fixtures/` (committed).

## Run

```bash
cd agent-desktop
node tests/run-suite.mjs
```

Or run individual files:

```bash
node --test tests/00-fixture-selfcheck.test.mjs
node --test tests/10-writer.test.mjs        # T03 — SKIPPED until merged
node --test tests/20-search.test.mjs        # T04 — SKIPPED until merged
node --test tests/30-consolidation.test.mjs # T05 — SKIPPED until merged
```

## What runs when

| File | Covers (§13) | Status today | Runs against |
|---|---|---|---|
| `00-fixture-selfcheck.test.mjs` | all rows — certifies the fixtures | ✅ PASS | fixtures only (no implementation) |
| `10-writer.test.mjs` | rows 1, 2, 3, 4, 13 + SEC-MEM-01 | ⏸ SKIPPED | T03 writer (Redmine #29, In Progress) |
| `20-search.test.mjs` | rows 5, 6, 7, 8 + SEC-MEM-01 | ⏸ SKIPPED | T04 tools (Redmine #30, In Progress) |
| `30-consolidation.test.mjs` | rows 9, 10, 11, 12, 14, 15 | ⏸ SKIPPED | T05 consolidation (Redmine #31, In Progress) |

The implementation suites are **skip-aware**: they probe for the T03/T04/T05
module in `agent-desktop/src/**` (see `tests/lib/harness.mjs` →
`IMPL_CANDIDATES`) and skip with the Redmine dependency reason when it is
absent. Skips are not failures — the suite stays green and reports exactly
what could not run and why.

## Layout

```text
tests/
├── run-suite.mjs              suite runner (node --test, spec reporter)
├── 00-fixture-selfcheck.test.mjs
├── 10-writer.test.mjs         T03 writer + quarantine + rotation + core.md parse
├── 20-search.test.mjs         T04 search_memory golden/filters + grep_logs + hot facts
├── 30-consolidation.test.mjs  T05 reflection/graduation/judge-gate/decay/conflict
├── lib/
│   ├── harness.mjs            fixture loader + implementation probing
│   ├── adapters.mjs           T03/T04/T05 module -> contract surface (integration point)
│   ├── schema.mjs             §5.2/§6.2/§9.3 schema oracle
│   └── generate-golden.mjs    golden-set generator (re-runnable, side-effect free on import)
└── fixtures/                  see fixtures/README.md
```

## CI

A GitHub Actions workflow (`.github/workflows/memory-t06.yml`) is supplied
in the T06 PR description: it runs this suite on pull requests that touch
`agent-desktop/**` (Node 20, `node tests/run-suite.mjs`). It is **not
committed to the branch** because the runner's GitHub token lacks the
`workflow` scope (GitHub refuses PAT pushes that create/update
`.github/workflows/*`); the platform can add it when the token is
upgraded. Until T03/T04/T05 merge, the job would pass with the fixture
selfcheck green and the implementation suites skipped. Locally the suite
is executed by the agent runner via `node tests/run-suite.mjs`.
