# Skill Evolution Acceptance Criteria — agent-desktop v0.5 (GEPA)

> **Status:** proposed (v1.0, for cto + pm + owner review) · **Owner:** ba (ba@agent-team.local)
> **Task:** TASK-7214 / Redmine #37 — T10: Acceptance criteria cho skill evolution
> **Source plan:** Redmine #22 (approved plan, decisions Q1–Q7) — Giai đoạn 2, executed by pm in TASK-7174 / Redmine #35
> **Inputs:** T09 design (#36, GEPA pipeline — in progress at time of writing) · SEC-GEPA-01…11 (`docs/security-review-memory.md` §5) · ADR-009 (Q4 sidecar boundary) · ADR-010 (Q5 judge-team security)
> **Project:** agent-desktop (subproject of agent-team) · **Version:** v0.5 Skill Evolution (due 2026-10-30)
> **Last updated:** 2026-09-01

This document is the **acceptance criteria contract for the GEPA skill
evolution pipeline** of `agent-desktop`. It states *what* "good" means —
for the eval dataset, the quantitative guardrails, the PR + human-review
workflow, and one completed evolution round — and is consumed by:

- **T11 [backend]** — eval dataset builder (must produce a dataset that
  satisfies §4).
- **T12 [backend]** — GEPA evolution runner + fitness gate (must run
  rounds and gate candidates per §5/§7).
- **T13 [backend]** — evolved-skill PR workflow (must implement §6).
- **T14 [tester]** — Windows Sandbox eval harness (must make §4.3
  coverage and §5 SEC-GEPA-02 measurable).
- **T15 [reviewer]** — pipeline + evolved-skill PR review (accepts
  against this document and `docs/security-review-memory.md` §5).
- **T19 [cto]** — release gate (signs off against the audit trail of
  §6.3 / SEC-GEPA-11).

Where T09 has not yet fixed a numeric default at the time of writing,
this document sets the **acceptance default**; the implementing task
(T11/T12/T14) may adjust the number only with a recorded deviation in
the run's audit trail (§6.3) — never below the stated minimum without a
written cto/pm decision.

---

## 1. Purpose and scope

The owner wants the agent to get better at recurring Windows tasks (first
skill: **install-dsh**, with a Windows Sandbox test suite and planted
failures — EFS, junction, service password). v0.5 introduces a GEPA
pipeline (plan #22 Q4/Q5) that turns **eval dataset → evolution →
guardrails → PR + human review** into a repeatable loop. This document
defines the acceptance criteria that make one loop **safe, measurable
and reviewable**:

1. **Eval dataset** (§4) — what a valid dataset is (sources, format,
   coverage, quality), so T11 can build it and T14 can score against it.
2. **Quantitative guardrails** (§5) — measurable acceptance criteria
   (metric + threshold + how to verify) for every SEC-GEPA-01…11
   requirement, so T12/T13/T15 can gate candidates objectively.
3. **PR + human review workflow** (§6) — how a candidate becomes a PR
   into the skill registry and how it is approved (owner + cto),
   with a replayable audit trail.
4. **Definition of "done" for one evolution round** (§7) — the exact
   merge conditions and the exact reject conditions, so every run ends
   in a clear, documented verdict.

**In scope:** the loop for evolved `SKILL.md` candidates of
`install-dsh` (and any future skill registered in the same registry).

**Out of scope (v0.5):** continuous auto-trigger loop (v0.6, T20);
memory UI / skill-diff UI (v0.5, T21); the memory foundation itself
(v0.4, T03–T08 — already merged).

---

## 2. Definitions

| Term | Meaning |
|---|---|
| **Skill** | A `SKILL.md` file in the skill registry (L4 procedural memory; see `docs/memory-spec.md` §3). v0.5 target: `install-dsh`. |
| **Skill registry** | The directory in the agent-team repo where reviewed skills live (layout defined by T09; registry write is Node/TS-trusted per ADR-009). |
| **Base skill** | The currently merged `SKILL.md` for a skill — the reference for semantic-preservation checks (SEC-GEPA-04). |
| **Eval dataset** | A versioned, hashed set of `{context, error, fix}` cases (§4.2) used to score candidates. |
| **Candidate** | A `SKILL.md` produced by one evolution step that the pipeline proposes as an improvement over the base skill. |
| **Evolution run** | One execution of the GEPA loop over a fixed dataset version, producing zero or more candidates. |
| **Fitness** | The eval-suite score of a candidate (SEC-GEPA-02): `passed / total × 100%` on the current dataset. |
| **Guardrail** | A mandatory, machine-checkable gate from SEC-GEPA-01…11 that a candidate must pass. |
| **Hot-swap** | Activating an evolved skill inside a live session before merge + human approval (forbidden, SEC-GEPA-05). |
| **Round verdict** | The final outcome of an evolution round: **merge-ready** or **rejected** (§7). |

---

## 3. User stories

### US-SKILL-001 — Evolve from real failures

> **As the owner**, I want the pipeline to learn from what actually
> fails on my Windows laptop (sandbox tests + real error logs), so that
> evolved skills fix real problems rather than imagined ones.

**Acceptance criteria:**

- AC-1: The eval dataset contains only cases traceable to an approved
  source (§4.1) — Windows Sandbox test results or real error logs.
- AC-2: Every case has the `{context, error, fix}` shape (§4.2) and
  schema-validates.
- AC-3: The dataset meets the minimum coverage thresholds (§4.3).
- AC-4: The dataset contains no secrets (§4.4 / SEC-GEPA-08).

### US-SKILL-002 — Evolve safely (guardrails)

> **As the owner and the cto**, I want every candidate to pass
> measurable, machine-checkable guardrails before it can be proposed
> for merge, so that generated code cannot hurt my laptop or my memory.

**Acceptance criteria:**

- AC-1: A candidate is merge-eligible only when it passes **all**
  SEC-GEPA-01…11 gates (§5) — each gate is a metric with a threshold
  and a verification method.
- AC-2: Guardrail results are recorded in the run's audit trail
  (SEC-GEPA-11) and attached to the PR (§6.2).

### US-SKILL-003 — Humans approve every evolved skill

> **As the owner**, I want to review and explicitly approve every
> evolved skill before it becomes active, so that no skill is merged or
> swapped in without my say-so (and the cto's).

**Acceptance criteria:**

- AC-1: Every candidate goes through a dedicated branch → PR into the
  skill registry (§6.1).
- AC-2: Merge requires explicit approval by **owner AND cto**
  (SEC-GEPA-06); no automated merge (SEC-GEPA-07).
- AC-3: Activation of an evolved skill happens only between sessions,
  after merge + approval (SEC-GEPA-05).

### US-SKILL-004 — Know exactly when a round is done

> **As the pm, the reviewer and the cto**, I want an unambiguous,
> documented definition of when an evolution round is done (merge) or
> not done (reject), so that every run has a clear verdict.

**Acceptance criteria:**

- AC-1: §7 defines the complete merge-condition set (all must hold).
- AC-2: §7 defines the complete reject-condition set (any one → reject,
  no merge).
- AC-3: Every run ends with a recorded verdict plus the audit-trail
  evidence that supports it (§6.3).

---

## 4. Eval dataset acceptance criteria (input to T11)

### 4.1 Sources (provenance)

Every dataset case must trace to **exactly one** approved source:

| Source | Evidence required | Provenance tag |
|---|---|---|
| **Windows Sandbox test** (T14 harness — `install-dsh` suite + planted failures: EFS, junction, service password) | Test case id + pass/fail result + captured output | `sandbox_test` |
| **Real error log** (DSH run logs / memory `sessions.jsonl` `{context, error, fix}` reflections / owner-provided failure reports per Q3) | Log file + line/session reference; owner-uploaded result where applicable | `error_log` |

Rules:

- **SRC-1:** a case with no verifiable source reference is invalid —
  the dataset builder must reject it at build time (mirror of the
  memory provenance rule, `docs/memory-spec.md` §4.3).
- **SRC-2:** a case derived from a real log must quote the error exactly
  (no paraphrase that changes the failure signature).
- **SRC-3:** sandbox-derived cases must come from the T14 harness
  manifest; the dataset must record the harness version used.

### 4.2 Format — Context → error → fix (T11 builder template)

Each case is a machine-readable record with **exactly** the following
shape (mirroring the reflection shape in `docs/memory-spec.md` §8.3):

```json
{
  "id": "EVAL-<skill>-<NNN>",
  "context": "<what the agent was doing + environment facts needed to reproduce>",
  "error": "<exact failure: message / exit code / symptom>",
  "fix": "<the correct handling, verified>",
  "scenario": "<scenario class, from the T14 harness manifest, e.g. efs|junction|service-password|happy-path>",
  "source": { "type": "sandbox_test|error_log", "ref": "<test-id | file:line>", "harness_version": "<T14 manifest version>" },
  "severity": "critical|major|minor",
  "verified": "sandbox-pass|human-confirmed"
}
```

Rules:

- **FMT-1:** `context`, `error`, `fix` are all non-empty; `fix` states
  the correct handling, not just "retry".
- **FMT-2:** `scenario` must be one of the classes declared in the T14
  harness manifest; an unknown scenario fails schema validation.
- **FMT-3:** `verified` is mandatory: `sandbox-pass` (the fix passes the
  corresponding harness test) or `human-confirmed` (owner/cto confirmed
  the fix is correct — Q3 evidence). **Unverified cases are excluded
  from the dataset.**
- **FMT-4:** the dataset is a single JSON/JSONL file with a declared
  schema version; every record must validate against it (T11 builder
  output; T14 scoring consumes the same schema).
- **FMT-5:** no duplicate `(context, error)` pairs; duplicates are
  deduplicated at build time and counted in the build report.

### 4.3 Minimum coverage

Defaults (env-configurable; see §8 for names):

| Metric | Acceptance default (minimum) |
|---|---|
| Total valid cases | `EVAL_MIN_CASES` = **20** |
| Cases per scenario class | `EVAL_MIN_CASES_PER_SCENARIO` = **3** for every class in the T14 manifest (happy-path + efs + junction + service-password = 4 classes ⇒ ≥ 12), and **every class present** (coverage = 100% of manifest classes) |
| Real-log-derived cases | `EVAL_MIN_REAL_LOG_CASES` = **1** per failure class that has real logs available (0 if no logs exist yet — recorded in the build report) |
| Verified cases | 100% (`verified` ≠ unverified) |

Rules:

- **COV-1:** if the T14 manifest declares a class with no cases, the
  dataset is **invalid** (a missing class means fitness cannot be
  measured for that failure mode).
- **COV-2:** the build report must record per-class counts, source
  counts, dedup counts and the dataset `sha256` hash.
- **COV-3:** the dataset is **immutable during a run**: a run pins a
  dataset version + hash; evolving against a different dataset is a
  different run.

### 4.4 Quality — no secrets (SEC-GEPA-08)

- **SEC-GEPA-08 (dataset):** the dataset MUST NOT contain API keys,
  tokens, or credential-shaped strings. The builder redacts tool output
  before use; the dataset fails validation on any secret-scan hit.
- **QL-1:** the secret-scan guard (`SEC-LOG-02`, repo-level scan for
  `OPENAI_`/`GEMINI_`/`DEEPSEEK_` and generic key shapes) runs on the
  dataset file in CI; **0 hits required**.
- **QL-2:** no secrets in `context`/`error`/`fix` text; redaction is
  applied at build time and re-scanned at scoring time.
- **QL-3:** dataset files are committed only to the dataset directory
  (not to logs); permission 0600 on local copies (mirror of
  `docs/memory-spec.md` §11).

---

## 5. Guardrail quantitative acceptance criteria (SEC-GEPA-01…11)

For **each** guardrail: **Metric** (what is measured) · **Threshold**
(the pass value) · **How to verify** (the check that produces evidence
for the audit trail). A candidate that fails any gate is **rejected**
(SEC-GEPA-02…04 explicit; the rest are mandatory pipeline invariants).

| # | Metric | Threshold (accept) | How to verify |
|---|---|---|---|
| **SEC-GEPA-01** Environment isolation | Count of sandbox escape events / forbidden accesses during the run | **0** — no network egress to the owner's laptop, no write access to the real workspace or real memory files; sandbox is disposable per run | Run evolution inside the sandbox (container/jail, ADR-009); CI asserts network egress is blocked (probe test), write to real paths returns EPERM, and the sandbox is destroyed after the run |
| **SEC-GEPA-02** Test suite 100% | Fitness = `passed / total × 100%` on the current dataset (T14 harness) | **100%** — any single failure ⇒ candidate rejected | T14 harness scores the candidate against the pinned dataset; report per-case pass/fail; assert pass rate = 100% |
| **SEC-GEPA-03** Size ≤ 15 KB | Candidate `SKILL.md` byte size | **≤ 15 KB** (15 360 bytes) | Script check (`wc -c` / equivalent) on the candidate file in CI; oversized ⇒ reject |
| **SEC-GEPA-04** Semantic preservation | Regression count = cases the base skill passes that the candidate fails, on the **same** eval suite | **0 regressions** — candidate pass set ⊇ base pass set; candidate fitness ≥ base fitness on the identical dataset | A/B run base vs candidate on the same pinned dataset; diff per-case results; any regression ⇒ reject |
| **SEC-GEPA-05** No hot-swap | Activation mode of the evolved skill | Evolved skill is **never** loaded in a live session; activation only between sessions, after merge + human approval | Code review + runtime test: an unmerged candidate cannot be activated by the DSH runtime; activation reads merged registry state only |
| **SEC-GEPA-06** Human review before merge | PR approvals (owner + cto) | **2 explicit approvals** — owner AND cto — recorded on the PR before merge | Branch protection / PR review records; workflow refuses merge with < 2 approvals |
| **SEC-GEPA-07** Auto-merge forbidden | Automated merge events | **0** — no auto-merge in CI, no runner-side merge on the agent's behalf | Repo settings (auto-merge off), CI workflow review, runner code review |
| **SEC-GEPA-08** No secrets in candidates/artifacts | Secret-scan hits on dataset + candidates + PR diff | **0 hits** | Secret-scan guard (SEC-LOG-02) in CI on dataset, candidate files, and PR diff |
| **SEC-GEPA-09** Cost cap integration (Q5) | Per-model spend vs monthly cap (defaults DeepSeek $15 / gpt-4 $10 / gemini-3 $10; base budget $30–50) | Spend ≤ cap per model; capped model auto-disables; **all capped ⇒ evolution pauses safely** (never unjudged) | Cost-tracker tests with mock providers (pattern of T05/T06); integration test: caps reached ⇒ pause, no candidate output |
| **SEC-GEPA-10** Supply-chain pinning | Pinned deps of the Python sidecar | Sidecar image + deps pinned by digest/version and built in CI; **no unpinned `pip install` at runtime** | CI build + lockfile/digest check; runtime install command blocked |
| **SEC-GEPA-11** Audit trail | Run-record completeness | Every run records: dataset hash, model verdicts, fitness scores, guardrail outcomes (size/semantic/test), verdict — **replayable** by T15/T19 | Schema validation of the run record; replay test: re-running the eval from the recorded dataset hash reproduces fitness |

Additional quantitative invariants (cross-cutting):

- **CG-1 (determinism):** guardrail checks (size, secret scan, A/B
  regression diff) are deterministic and re-runnable from the audit
  trail alone (SEC-GEPA-11 replay).
- **CG-2 (ordering):** guardrails run in the trusted Node/TS layer or an
  isolated eval (ADR-009 §6.3); candidate self-reported values are
  never trusted without re-validation.

---

## 6. PR + human review workflow (T13)

### 6.1 Candidate → branch → PR

- **BR-1:** each candidate goes to a **dedicated branch**
  (`evolution/<skill>/<run-id>-<candidate>` or the T09-defined pattern);
  candidates never commit directly to `develop`.
- **BR-2:** the PR targets the **skill registry** in the agent-team repo
  (T09 layout) and contains only: the candidate `SKILL.md`, the dataset
  version reference, and the run audit record.
- **BR-3:** the PR body must include (§6.2 metadata) — a PR without it
  is auto-flagged by CI (missing metadata = gate fail).

### 6.2 PR metadata (SEC-GEPA-06/07/11 evidence)

| Field | Source |
|---|---|
| Run id + dataset version + dataset `sha256` | Audit trail (SEC-GEPA-11) |
| Fitness (SEC-GEPA-02) + size (SEC-GEPA-03) + regression diff vs base (SEC-GEPA-04) | Guardrail results |
| Guardrail checklist (all of SEC-GEPA-01…11: pass/fail + evidence ref) | Audit trail |
| Cost report (per-model spend, no keys — SEC-COST-02 / SEC-GEPA-09) | Cost tracker |
| Candidate diff vs base skill | Git diff |

### 6.3 Audit trail (SEC-GEPA-11)

- **AT-1:** the run record is written after every run (success or
  failure) with the fields of §5 (dataset hash, verdicts, fitness,
  guardrail outcomes, verdict).
- **AT-2:** the run record is **replayable**: given the record (dataset
  hash + harness version + candidate), T15/T19 can re-derive fitness
  and guardrail outcomes without the original environment.
- **AT-3:** every PR links to its run record; every run record links to
  its PR (or states "no PR — rejected before PR").

---

## 7. Definition of "done" for one evolution round

### 7.1 Merge conditions — a round is **done (merge-ready)** only when **ALL** hold

| # | Condition | Reference |
|---|---|---|
| D-1 | Eval dataset is valid: sources traceable (§4.1), `{context,error,fix}` schema-valid (§4.2), coverage thresholds met (§4.3), no secrets (§4.4) | §4, SEC-GEPA-08 |
| D-2 | Evolution run completed successfully (exit 0, run record written) | §6.3 |
| D-3 | Candidate fitness = **100%** on the pinned dataset | SEC-GEPA-02 |
| D-4 | No regression vs base skill (candidate pass set ⊇ base pass set; fitness ≥ base) | SEC-GEPA-04 |
| D-5 | All guardrails pass: SEC-GEPA-01, 03, 05, 06, 07, 09, 10, 11 (in addition to 02/04/08 above) | §5 |
| D-6 | PR opened into the skill registry with full §6.2 metadata | §6.1/§6.2 |
| D-7 | Human review complete: **owner AND cto approved** | SEC-GEPA-06 |
| D-8 | Merged by a human (no automated merge) | SEC-GEPA-07 |
| D-9 | Activation scheduled between sessions (no hot-swap) | SEC-GEPA-05 |

### 7.2 Reject conditions — a round is **not done (rejected — no merge)** when **ANY** holds

| # | Condition | Reference |
|---|---|---|
| R-1 | Dataset invalid: any of §4.1–§4.4 fails (bad source, schema, coverage, or a secret found) | §4, SEC-GEPA-08 |
| R-2 | Evolution run failed/crashed, or produced no candidate | §6.3 |
| R-3 | Fitness < 100% — any eval case fails | SEC-GEPA-02 |
| R-4 | Any regression vs base skill | SEC-GEPA-04 |
| R-5 | Size > 15 KB | SEC-GEPA-03 |
| R-6 | Hot-swap attempt (candidate activated in a live session) | SEC-GEPA-05 |
| R-7 | Fewer than 2 approvals, or any non-human (owner/cto) approval path | SEC-GEPA-06 |
| R-8 | Any automated merge attempt | SEC-GEPA-07 |
| R-9 | Secret-scan hit in dataset/candidate/PR | SEC-GEPA-08 |
| R-10 | Cost caps exceeded ⇒ evolution **paused** (no candidate produced in the first place) | SEC-GEPA-09 |
| R-11 | Run record missing/incomplete/not replayable | SEC-GEPA-11 |

**Reject outcome:** the candidate is **never merged**; a `rejection`
verdict is written to the run record with the failing condition(s) and
evidence — mirroring the memory rejection-record concept
(`docs/memory-spec.md` §8.4 AC-2). Rejected candidates may be re-run in
a later round from the same or a new dataset.

### 7.3 Round verdict summary

Every round ends in exactly one verdict:

- **merge-ready** — D-1…D-9 all hold (PR merged by human, activation
  between sessions); or
- **rejected** — any R-1…R-11 holds (no merge; reason + evidence
  recorded); or
- **paused** — R-10 applies (cost caps; no candidate; resume after
  reset/cap change).

---

## 8. Environment defaults (configurable names)

| Variable | Default | Meaning |
|---|---|---|
| `EVAL_MIN_CASES` | 20 | Minimum total dataset cases (§4.3) |
| `EVAL_MIN_CASES_PER_SCENARIO` | 3 | Minimum cases per scenario class (§4.3) |
| `EVAL_MIN_REAL_LOG_CASES` | 1 | Minimum real-log-derived cases per failure class when logs exist (§4.3) |
| `EVAL_DATASET_SCHEMA_VERSION` | 1 | Dataset schema version (§4.2 FMT-4) |
| `EVOLUTION_MAX_CANDIDATES` | (T09/T12) | Candidates per run (T09 design) |
| `EVOLUTION_FITNESS_THRESHOLD` | 1.0 | = 100% (SEC-GEPA-02; fixed, not lowered) |
| `EVOLUTION_SIZE_LIMIT_BYTES` | 15360 | = 15 KB (SEC-GEPA-03; fixed, not raised) |
| `JUDGE_CAP_DEEPSEEK_USD` / `JUDGE_CAP_GPT4_USD` / `JUDGE_CAP_GEMINI3_USD` | 15 / 10 / 10 | Per-model monthly caps (SEC-GEPA-09; Q5) |

---

## 9. Acceptance criteria mapping (consumed by T11–T15, T19)

| Section / guardrail | Testable acceptance criterion | Implemented/verified by |
|---|---|---|
| §4.1 SRC-1…3 | Dataset case without a verifiable source ⇒ invalid at build time | T11 build + T14 scoring |
| §4.2 FMT-1…5 | Every record `{context,error,fix}` schema-validates; no duplicates | T11 builder + T14 fixtures |
| §4.3 COV-1…3 | Coverage thresholds; every manifest class present; dataset hash pinned | T11 build report + T14 harness |
| §4.4 QL-1…3 / SEC-GEPA-08 | 0 secret-scan hits on dataset | CI secret-scan guard (SEC-LOG-02) |
| SEC-GEPA-01 | 0 escape events; egress blocked; sandbox disposable | T12 sandbox + CI probe test |
| SEC-GEPA-02 | Fitness = 100% on pinned dataset | T14 harness + T12 gate |
| SEC-GEPA-03 | Size ≤ 15 KB | CI size check (T12/T13) |
| SEC-GEPA-04 | 0 regressions vs base on same dataset | T14 A/B run + T12 gate |
| SEC-GEPA-05 | No activation in live session; between sessions after merge | T13 workflow + runtime test |
| SEC-GEPA-06 | 2 approvals (owner + cto) before merge | T13 PR workflow + branch protection |
| SEC-GEPA-07 | 0 auto-merge events | Repo settings + T13 workflow |
| SEC-GEPA-09 | Per-model caps; all-capped ⇒ pause | T12 + cost-tracker tests (mock providers) |
| SEC-GEPA-10 | Pinned sidecar image/deps; no runtime unpinned install | CI build + lockfile check |
| SEC-GEPA-11 | Run record complete + replayable | T12/T13 write; T15/T19 replay |
| §7 | Every round ends in merge-ready / rejected / paused with evidence | T12/T13 verdict + T15 review |

---

## 10. Traceability

| Artifact | Reference |
|---|---|
| Task | TASK-7214 / Redmine #37 — T10 acceptance criteria cho skill evolution |
| Source plan | Redmine #22 (Q1–Q7, notes 16:37 + 16:48), Giai đoạn 2 — T09…T19 |
| Security contract | `docs/security-review-memory.md` §5 (SEC-GEPA-01…11), §6 (ADR-009), §7 (ADR-010) |
| Design input | T09 GEPA pipeline design (#36) — this document is the acceptance view of it |
| Downstream tasks | T11 eval dataset builder → T12 GEPA runner + fitness gate → T13 PR workflow → T14 harness → T15 review → T19 release gate |
| Decisions | `DECISIONS.md` ADR-009/010 (existing) + ADR-015 (this PR) |
| Redmine | Issue #37 + project agent-desktop, version v0.5 Skill Evolution |
