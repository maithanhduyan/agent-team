# GEPA eval dataset builder (T11) — agent-desktop v0.5

> **Task:** TASK-8866 / Redmine #44 — T11: Eval dataset builder
> **Author:** backend (backend@agent-team.local)
> **Contract:** `docs/skill-evolution-acceptance.md` §4 (T10, ADR-018) ·
> `docs/gepa-pipeline.md` §3.1 stage 1 / §5.1 (T09, ADR-015/016/017) ·
> `docs/security-review-memory.md` §5 (SEC-GEPA-01…11) + ADR-009/010
> **Consumed by:** T12 (GEPA runner + fitness gate) · T14 (eval harness) · T15 (reviewer)

This directory implements the **eval dataset builder** of the GEPA
pipeline: it converts **Windows Sandbox test results (T14 harness)** and
**real error logs** into the *Context → error → fix* dataset that scores
every evolved `install-dsh` skill candidate.

A dataset is **valid** iff every case is traceable to an approved source,
schema-valid, coverage-complete, deduplicated, and free of secrets — the
builder enforces all of this **at build time** and refuses to produce an
invalid dataset.

## 1. Layout

```text
evolution/
├── contracts/
│   └── eval-dataset.schema.json     # dataset schema v1 (FMT-4; T14 scoring consumes the same schema)
├── src/
│   ├── build-eval-dataset.ts        # CLI builder (entry point)
│   ├── dataset.ts                   # core library: provenance, validation, dedup, coverage, report
│   ├── secret-scan.ts               # SEC-LOG-02 guard (QL-1) — CLI + library
│   └── validate.ts                  # minimal JSON Schema (draft-07 subset) validator
├── test/
│   └── build-eval-dataset.test.ts   # 27 tests: SRC/FMT/COV/QL + CLI contract
├── fixtures/
│   ├── sandbox/                     # T14 harness inputs (manifest + Mode A results + curation)
│   │   ├── manifest.json            #   scenario classes + test cases (T14 format proposal — see §5)
│   │   ├── results/mode-a.json      #   harness run results (planted failures present)
│   │   └── case-curation.jsonl      #   curated context/fix/severity per sandbox case
│   └── logs/                        # real error logs + curated error-log cases
│       ├── dsh-run.log              #   DSH run log (fixture; real logs slot in)
│       ├── owner-failure-report.md  #   owner Q3 failure report (fixture)
│       └── error-log-cases.jsonl    #   error-log dataset drafts (ref = <file>:<line>)
├── datasets/                        # *** the ONLY place dataset files are committed (QL-3) ***
│   └── install-dsh-v0.1.json        # sample dataset v0.1 (schema v1, 24 cases)
├── reports/
│   └── install-dsh-v0.1.report.json # build report: counts + coverage + dedup + sha256 + scan
└── runs/                            # SEC-GEPA-11 run manifests (written by T12; gitignored JSON)
```

## 2. How to run

From the repository root (the builder resolves source refs against the
repo root):

```bash
# Build the sample dataset (fixtures) → dataset + build report (0600 perms)
./agent-desktop/node_modules/.bin/tsx agent-desktop/evolution/src/build-eval-dataset.ts \
  --manifest agent-desktop/evolution/fixtures/sandbox/manifest.json \
  --results  agent-desktop/evolution/fixtures/sandbox/results/mode-a.json \
  --case-curation agent-desktop/evolution/fixtures/sandbox/case-curation.jsonl \
  --error-log-cases agent-desktop/evolution/fixtures/logs/error-log-cases.jsonl \
  --out agent-desktop/evolution/datasets/install-dsh-v0.1.json \
  --report agent-desktop/evolution/reports/install-dsh-v0.1.report.json
```

or via npm (from `agent-desktop/`):

```bash
cd agent-desktop
npm run eval:dataset -- \
  --manifest evolution/fixtures/sandbox/manifest.json \
  --results  evolution/fixtures/sandbox/results/mode-a.json \
  --case-curation evolution/fixtures/sandbox/case-curation.jsonl \
  --error-log-cases evolution/fixtures/logs/error-log-cases.jsonl \
  --out evolution/datasets/install-dsh-v0.1.json \
  --report evolution/reports/install-dsh-v0.1.report.json
```

Useful flags:

| Flag | Meaning |
|---|---|
| `--timestamp <iso>` | Pin `built_at` for a reproducible build (same inputs ⇒ same `sha256`). |
| `--force` | Rebuild an existing dataset deliberately (COV-3: refused by default). |
| `--root <dir>` | Repo root used to resolve `error_log` refs (default `process.cwd()`). |
| `--allow-any-path` | Scratch builds only; bypasses the QL-3 datasets/reports dir guard. |

**Secret scan** (SEC-LOG-02 / QL-1, also run automatically at build time):

```bash
cd agent-desktop
npm run eval:scan -- evolution/datasets/install-dsh-v0.1.json   # exit 0 ⇔ 0 hits
```

**Tests + typecheck:**

```bash
cd agent-desktop
npm run test:evolution        # 27 tests
npm run typecheck:evolution   # tsc --noEmit -p evolution/tsconfig.json
```

## 3. Inputs (SRC-1..3 — every case must trace to exactly one source)

| Input | Format | Provenance tag |
|---|---|---|
| T14 harness manifest | `fixtures/sandbox/manifest.json` (see §5) | — |
| T14 harness results | `fixtures/sandbox/results/mode-a.json` (or Mode B owner-uploaded) | `sandbox_test` |
| Case curation (sandbox) | `fixtures/sandbox/case-curation.jsonl` — one draft per dataset case | `sandbox_test` |
| Real error logs | any text file (DSH run logs, memory `sessions.jsonl` reflections, owner Q3 reports) | `error_log` |
| Error-log cases | `fixtures/logs/error-log-cases.jsonl` — `ref` = `<file>:<line>` of the real log | `error_log` |

Guarantees (enforced at build time — build **fails** otherwise):

- **SRC-1** — every case has a verifiable source: sandbox `case_id` must
  exist in the manifest with a result entry; `error_log` ref must point at
  a real file and line. No source ⇒ rejected at build time.
- **SRC-2** — the `error` of a log-derived case is **quoted exactly** from
  the referenced log line (the builder greps the line and rejects
  paraphrases). The `error` of a failed sandbox case must equal the
  captured failure.
- **SRC-3** — sandbox cases come from the T14 manifest; the dataset records
  `harness_version` on every case and requires results' version to match
  the manifest's.

## 4. Format, coverage, quality (FMT / COV / QL)

- **FMT-1..5** — every record is `{id, context, error, fix, scenario,
  source{type,ref,harness_version}, severity, verified}`; `context`/`error`/
  `fix` non-empty; `fix` is the correct handling (never just "retry");
  `scenario` ∈ manifest classes; `verified` ∈ {`sandbox-pass`,
  `human-confirmed`}; no duplicate `(context, error)` pairs (deduped and
  counted in the report).
- **FMT-3** — `verified` is mandatory: `sandbox-pass` requires the
  fix-validation test to have passed in the harness results
  (`fix_case_id` in the curation, defaults to the case itself);
  `human-confirmed` is used for owner/cto-confirmed log cases (Q3).
  Unverified cases are excluded.
- **FMT-4** — single JSON dataset with `schema_version: 1`, validated
  against `contracts/eval-dataset.schema.json` (the same schema T14 uses
  to score).
- **COV-1..3** — total ≥ `EVAL_MIN_CASES` (20); every manifest class ≥
  `EVAL_MIN_CASES_PER_SCENARIO` (3); real-log cases ≥
  `EVAL_MIN_REAL_LOG_CASES` (1) per class **that has logs available**
  (classes without logs are recorded `logs_available: false` in the
  report); verified = 100%; the build report records per-class counts,
  per-source counts, dedup counts and the dataset `sha256`; the dataset is
  **immutable during a run** — a run pins dataset version + hash, and the
  builder refuses to overwrite an existing dataset (COV-3).
- **SEC-GEPA-08 / QL-1..3** — tool output is redacted before use
  (`redactSecrets`, shared with the judge/reflection path); the final
  dataset is secret-scanned (provider env refs `OPENAI_/GEMINI_/DEEPSEEK_`,
  `sk-...`, `AIza...`, bot tokens, `KEY=value` assignments, PEM blocks) —
  **0 hits required**; dataset files are committed only under `datasets/`
  and local copies are written with permission `0600`.

## 5. T14 harness assumption (coordination note)

T14 (Windows Sandbox eval harness) had **not yet merged a manifest** at
T11 build time. Per the T11 task brief, T11 works with the fixtures/suite
already available and records the assumption:

> **Assumption:** T14 adopts the harness manifest format defined in
> `fixtures/sandbox/manifest.json` (schema_version 1, `harness`,
> `harness_version`, `scenario_classes` with `planted_failure` flags,
> `cases[id, scenario, name]`) and emits results in the format of
> `fixtures/sandbox/results/mode-a.json`
> (`{harness_version, run_id, mode, results[{case_id, passed, error, captured_output}]}`).
> The four scenario classes are pinned by the acceptance contract
> (T10 §4.3): `happy-path`, `efs`, `junction`, `service-password`.

When T14 lands, its manifest/results replace these fixtures; the dataset
is rebuilt with `harness_version` bumped and a new dataset id. The
fixture logs under `fixtures/logs/` are **planted stand-ins** for real
DSH run logs / owner reports; the EFS case
`agent-desktop/tests/fixtures/memory/sessions.jsonl:9` is a real source
from the v0.4 memory fixtures and demonstrates the exact-quote check.

## 6. Env vars (T10 §8)

| Variable | Default | Meaning |
|---|---|---|
| `EVAL_MIN_CASES` | 20 | Minimum total dataset cases |
| `EVAL_MIN_CASES_PER_SCENARIO` | 3 | Minimum cases per scenario class |
| `EVAL_MIN_REAL_LOG_CASES` | 1 | Minimum real-log cases per class when logs exist |
| `EVAL_DATASET_SCHEMA_VERSION` | 1 | Dataset schema version (only 1 exists) |

## 7. CI integration points (for T12/T13/T15/T19)

- **Build + scan in CI:** run the builder with the pinned fixtures/real
  inputs, then `secret-scan.ts` on the dataset file (QL-1 / SEC-LOG-02) —
  both must exit 0. The report's `sha256` is the pinned dataset hash
  recorded in the run manifest (SEC-GEPA-11).
- **Consumed by T12:** the runner pins `dataset_id` + `sha256` from the
  report and passes the dataset file to the Python sidecar
  (`initialize` validates the hash — `docs/gepa-pipeline.md` §4.3).
- **Consumed by T14:** scoring validates candidate results against the
  same `contracts/eval-dataset.schema.json`.

## 8. Traceability

| Requirement | Where implemented / verified |
|---|---|
| SRC-1..3 | `dataset.ts` `verifySandboxSource` / `verifyErrorLogSource`; tests `SRC-*` |
| FMT-1..5 | `validateRecordShape`, `dedupKey`, `contracts/eval-dataset.schema.json`; tests `FMT-*` |
| COV-1..3 | `checkCoverage`, CLI immutability guard, report `sha256`; tests `COV-*` |
| QL-1..3 / SEC-GEPA-08 | `secret-scan.ts`, `redactRecord`, `assertDatasetOutputPath`, `chmod 0600`; tests `QL-*`/`SEC-GEPA-08` |
| T10 §9 mapping | this README + `docs/skill-evolution-acceptance.md` §9 (rows for T11) |
| ADR | `DECISIONS.md` ADR-020 (this task) |
| Redmine | #44 (T11) · plan #22 · T09 #36 · T10 #37 |
