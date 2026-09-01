# T14 — GEPA eval harness for `install-dsh` (Windows Sandbox suite, packaged as a fitness gate)

> **Task:** TASK-8867 / Redmine #45 — T14: harness Windows Sandbox (v0.5 Skill Evolution)
> **Owner:** tester (tester@agent-team.local) · **Project:** agent-desktop (subproject of agent-team) · **Version:** v0.5 Skill Evolution (due 2026-10-30)
> **Inputs:** SEC-GEPA-01…11 (`docs/security-review-memory.md` §5) · T09 design (`docs/gepa-pipeline.md` §5) · T10 acceptance (`docs/skill-evolution-acceptance.md` §4.3, §5)
> **Consumed by:** T11 (dataset builder — scenario manifest + coverage), T12 (fitness gate), T17 (E2E merge evidence)

This directory packages the **install-dsh test suite** as a runnable
fitness gate for the GEPA evolution pipeline: happy path
(install / idempotency / cleanup) + **planted failures** (EFS
encryption, junction handling, service-password handling), each case
with an explicit scenario class and pass/fail criteria declared in
`manifest.json`.

## Layout

```text
evolution/harness/
├── manifest.json                 # scenario classes + version + 12 cases (T11 coverage standard)
├── schema/
│   ├── manifest.schema.json      # JSON Schema for the manifest
│   └── result.schema.json        # unified result JSON schema (both modes)
├── lib/
│   ├── manifest.mjs              # manifest loader + validator (COV-1)
│   ├── cases.mjs                 # Mode A executable case checks
│   ├── sandbox.mjs               # disposable fixture sandbox (EFS/junction/service sims)
│   ├── runner.mjs                # suite runner -> result document
│   ├── fitness.mjs               # fitness(c) = Σ w_i·pass_i / Σ w_i + gate (SEC-GEPA-02)
│   └── validate.mjs              # zero-dep JSON-Schema-subset validator
├── impl/
│   ├── reference.mjs             # base-skill reference behavior (Mode A, must pass 12/12)
│   └── mutants/
│       ├── efs-ignore.mjs        # planted failure: ignores EFS
│       ├── junction-naive.mjs    # planted failure: naive junction handling
│       └── svc-no-restart.mjs    # planted failure: no service restart
├── fixtures/
│   └── install-dsh/SKILL.md      # base-skill fixture (registry copy lands with T13)
├── mode-a/
│   └── run-mode-a.mjs            # Mode A CLI (offline / CI)
├── mode-b/
│   ├── run-mode-b.ps1            # Mode B harness (owner runs in Windows Sandbox)
│   ├── owner-instructions.md     # step-by-step instructions for the owner
│   └── result-form.md            # result form the owner fills/upload
├── tests/
│   └── harness-selfcheck.test.mjs # selfcheck (manifest/schema/fitness/planted detection)
└── results/                       # generated result JSON (golden reference committed)
```

## Scenario classes & cases (manifest)

| Class | Cases | Planted failure covered |
|---|---|---|
| `happy-path` | `hp-install`, `hp-idempotency`, `hp-cleanup` | — (normal install behavior) |
| `efs` | `efs-detect-target`, `efs-copy-source`, `efs-cleanup-encrypted` | skill ignores EFS encryption |
| `junction` | `jct-resolve`, `jct-traverse`, `jct-cleanup` | naive NTFS junction handling (recursion loop, deleting target contents) |
| `service-password` | `svc-update-credential`, `svc-restart`, `svc-failure-safe` | updates credential but never restarts / not failure-safe |

Every case belongs to **exactly one** class; the manifest declares the
classes with `min_cases` floors. **T11 dataset builder** uses this
manifest as its coverage standard: **COV-1 (T10 §4.3)** — a declared
class with no cases makes the dataset invalid. `lib/manifest.mjs`
enforces this.

## Fitness function (ADR-016 / T09 §5.2)

```
fitness(c) = ( Σ_i w_i · pass_i ) / ( Σ_i w_i )   ∈ [0, 1]
```

- `w_i ∈ (0,1]` case weight (default uniform `1`; the dataset manifest
  may weight safety-critical classes higher **for ranking only**).
- `pass_i = 1` iff `status === 'pass'` (fail/skip/error count as 0).
- **Threshold: 1.0 (100%)** — SEC-GEPA-02 / T10 §5; any non-pass
  rejects the candidate.

`lib/fitness.mjs` exposes `fitnessOfResult(result)` and `gate(result)`
(the T12 consumer). It validates the result against
`schema/result.schema.json` before scoring — a malformed result is a
REJECT, never silently scored.

## Modes (T09 §5.4 Q3)

### Mode A — offline (repo/CI) — `mode-a/run-mode-a.mjs`

Deterministic in the Linux eval sandbox; Windows-only behaviors
(EFS, junctions, service credential store) are **simulated as
fixtures** (`lib/sandbox.mjs`) with planted-failure mutants proving the
suite detects each failure mode. Used for evolution-loop fitness + the
100% gate.

```bash
# Reference (base skill) — must pass 12/12, fitness 1.0
node mode-a/run-mode-a.mjs --out results/mode-a-reference.json

# Planted-failure detection matrix (CI gate on the harness itself)
node mode-a/run-mode-a.mjs --verify-planted

# Any behavior module (candidate proxy contract — see below)
node mode-a/run-mode-a.mjs --behavior ./my-candidate-behavior.mjs

# Selfcheck (node built-in test runner, zero deps)
node --test evolution/harness/tests/harness-selfcheck.test.mjs
```

Exit code `0` = gate PASS (fitness 1.0), `1` = REJECT/invalid.

### Mode B — real Windows Sandbox (owner laptop) — `mode-b/`

The **owner** runs `run-mode-b.ps1` **manually** inside Windows Sandbox
(no code knowledge required — see `owner-instructions.md`), then fills
`result-form.md` and uploads both. The same 12 cases run with **real
Windows semantics** (real NTFS junctions via `New-Item -ItemType
Junction`, real EFS via `cipher.exe`, real file ops); the result JSON
uses the **identical schema**, so Mode B results plug straight into the
T12 gate. Mode B is the final evidence before merge (T17) and feeds
dataset refresh (T11).

## Candidate behavior proxy (T12 contract)

The harness executes a **behavior module** — the executable encoding of
what the skill-under-test would do. A candidate `SKILL.md` (text) is
scored by supplying a behavior module with the reference interface
(`impl/reference.mjs` is the base-skill example; mutants are the
negative examples). The interface methods (all returning serializable
data):

| Method | Purpose |
|---|---|
| `install(sandbox)` | install: create bin + config, resolve junctions, detect EFS |
| `cleanup(sandbox)` | remove artifacts, junction-safe, EFS-safe |
| `efsDetectTarget(sandbox)` | detect EFS-encrypted target → refuse with EFS message |
| `efsCopySource(sandbox)` | copy from EFS source → plaintext destination |
| `efsCleanup(sandbox)` | remove encrypted artifacts without residue |
| `jctResolve(sandbox)` | resolve junction link → real target |
| `jctTraverse(sandbox)` | bounded traversal (terminates on cycles) |
| `jctCleanup(sandbox)` | remove junction link, keep target contents |
| `svcUpdateCredential(sandbox, hash)` | update credential + restart service |
| `svcFailureSafe(sandbox)` | on failure preserve previous credential |

T12 maps a candidate's `SKILL.md` to a behavior module (e.g. via the
judge / deterministic extraction) and runs the suite; the gate then
consumes the emitted JSON. SEC-GEPA-04 (regression): the candidate's
behavior must pass every case the base reference passes.

## CI

The harness has **zero runtime dependencies** (node built-ins only).
CI can run:

```bash
node --test evolution/harness/tests/harness-selfcheck.test.mjs   # harness selfcheck
node mode-a/run-mode-a.mjs --verify-planted                       # planted detection
node mode-a/run-mode-a.mjs                                        # reference 12/12
```

(A committed GitHub Actions workflow is intentionally not shipped —
the runner's token lacks the `workflow` scope, same convention as the
T06 suite; the platform can add `.github/workflows/` when the token is
upgraded. The commands above are the CI contract.)

## Security mapping (SEC-GEPA-01…11)

| Requirement | Where the harness satisfies it |
|---|---|
| SEC-GEPA-01 isolation | Mode A runs in a disposable sandbox (`createSandbox` temp dir per case, destroyed in `finally`); no network, no host writes |
| SEC-GEPA-02 suite 100% | `gate()` threshold 1.0 on the unified result schema (both modes) |
| SEC-GEPA-03 size | Candidate `SKILL.md` size guard is T12's size check; the result document carries candidate metadata (`size_bytes`) |
| SEC-GEPA-04 no regression | Reference behavior = base skill; candidate must pass every case the reference passes (A/B on the same suite) |
| SEC-GEPA-08 no secrets | Fixture service password is a fake hash (`OLD_HASH`/`NEW_HASH`); result form instructs the owner to redact; no keys anywhere in the harness |
| SEC-GEPA-11 audit trail | Result JSON is replayable: same manifest + behavior + harness version ⇒ same per-case statuses (selfcheck test #6) |

## Traceability

| Artifact | Reference |
|---|---|
| Task | TASK-8867 / Redmine #45 (T14 harness) |
| Design | `docs/gepa-pipeline.md` §5 (fitness gate, modes, ADR-016) |
| Acceptance | `docs/skill-evolution-acceptance.md` §4.3 (COV-1), §5 (SEC-GEPA-02) |
| Security | `docs/security-review-memory.md` §5 (SEC-GEPA-01…11) |
| Consumed by | T11 (scenario manifest), T12 (fitness gate), T17 (E2E) |
| Results | `agent-desktop/TESTING.md` §T14; `results/mode-a-reference.json` (golden) |
