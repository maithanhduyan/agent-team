# Decisions (ADR)

Architecture and scope decisions are recorded here as short ADRs, in
reverse chronological order. Add a new entry whenever a public contract,
the project architecture, or the product scope changes.

> **Note on ADR numbering:** this file is introduced on `develop` by
> several PRs in parallel — PR #8 (TASK-180, demo skeleton
> requirements) carries ADR-001…ADR-003; PR #9 (TASK-6060, memory
> foundation) carries ADR-004…ADR-008; PR #10 (TASK-6539, T02
> architecture & security review) adds ADR-009…ADR-010; PR #14
> (TASK-6644, T03 core memory module) adds ADR-011; PR #15 (TASK-6645,
> T04 retrieval tools) adds ADR-012; PR #16 (TASK-6646, T05
> consolidation job) adds ADR-013; PR #17 (TASK-6654, T08 Telegram
> bridge) adds ADR-014; the T09 GEPA pipeline design PR (TASK-7213 /
> Redmine #36) adds ADR-015…ADR-017; the T10 skill-evolution acceptance
> PR (TASK-7214 / Redmine #37) adds ADR-018 (renumbered on merge by pm —
> ba's working number 015 collided with cto's ADR-015). The T11 eval
> dataset builder PR (TASK-8866 / Redmine #44) adds ADR-020. On merge, keep
> all sets; the
> second PR to merge reconciles the file (trivial append). Per the cto
> ADR-ownership rule (see the TASK-179 version of this file), the cto
> assigns final numbers on merge; working numbers on branches never
> collide because each PR appends its own range.

## ADR-020 — Eval dataset builder (T11): source contracts, layout, immutability (Redmine #44)

- **Status:** proposed (TASK-8866 / Redmine #44; T11 — eval dataset
  builder for the GEPA pipeline; contract T10 §4 / ADR-018, design T09
  §3.1 stage 1)
- **Date:** 2026-09
- **Context:** the GEPA pipeline needs a versioned, hashed eval dataset
  ("Context → error → fix") built from Windows Sandbox tests (T14) and
  real error logs, with every case traceable to exactly one approved
  source (T10 §4.1). T14 (harness manifest) had not merged at T11 build
  time, so T11 must fix the builder contracts and the dataset layout
  that T12/T14 consume.
- **Decision (backend scope):**
  - **Layout:** all GEPA evolution infrastructure lives under
    `agent-desktop/evolution/` (contracts/, src/, test/, fixtures/,
    datasets/, reports/, runs/); `EVOLUTION_RUNS_DIR` defaults to
    `<agent-desktop>/evolution/runs`. Dataset files are committed **only**
    under `datasets/` (QL-3); build reports under `reports/`; run
    manifests (`SEC-GEPA-11`) under `runs/` are gitignored.
  - **T14 assumption (coordinated with tester):** the harness manifest
    format is fixed as `fixtures/sandbox/manifest.json`
    (`schema_version`, `harness`, `harness_version`, `scenario_classes`
    with `planted_failure`, `cases[id, scenario, name]`) and the results
    format as `fixtures/sandbox/results/mode-a.json`. The four scenario
    classes are pinned by T10 §4.3: `happy-path`, `efs`, `junction`,
    `service-password`. When T14 merges its manifest, fixtures are
    replaced and the dataset rebuilt with a bumped `harness_version` and
    a new dataset id.
  - **Source contracts (SRC-1..3):** sandbox cases must reference a
    manifest `case_id` with a result entry; failed sandbox cases must
    quote the captured failure exactly; `verified: sandbox-pass` requires
    the fix-validation test (`fix_case_id`) to have passed in the
    results. Error-log cases carry `ref = <file>:<line>` and the builder
    verifies the error is **quoted exactly** from that line of a real
    file — an unverifiable source fails the build (mirror of the memory
    provenance rule, `docs/memory-spec.md` §4.3).
  - **Format (FMT-1..5):** one JSON dataset file
    (`schema_version: 1`) validated against
    `contracts/eval-dataset.schema.json` (the same schema T14 scores
    with). Records are `{id, context, error, fix, scenario, source,
    severity, verified}`; `fix` must be the correct handling (never just
    "retry"); dedup on normalized `(context, error)` at build time,
    counted in the report.
  - **Coverage + immutability (COV-1..3):** thresholds
    `EVAL_MIN_CASES=20`, `EVAL_MIN_CASES_PER_SCENARIO=3`,
    `EVAL_MIN_REAL_LOG_CASES=1` (per class with logs available — classes
    without logs are recorded `logs_available: false` in the report);
    every manifest class must be present; the report records per-class /
    per-source / dedup counts and the dataset `sha256` (computed over the
    exact serialized bytes). The builder refuses to overwrite an existing
    dataset file (`--force` to rebuild deliberately) so a run pins
    dataset version + hash.
  - **No secrets (SEC-GEPA-08 / QL-1..3):** tool output is redacted
    before use (shared `redactSecrets`); the final dataset is
    secret-scanned (`secret-scan.ts` — provider env refs `OPENAI_/
    GEMINI_/DEEPSEEK_`, `sk-...`, `AIza...`, bot tokens, `KEY=value`
    assignments, PEM blocks) with **0 hits required**; local copies are
    written `0600`.
  - **Determinism (CG-1):** dataset builds are deterministic given the
    inputs and a pinned `built_at` (`--timestamp`), so the same inputs
    reproduce the same `sha256` — guardrail checks stay re-runnable from
    the audit trail alone.
- **Consequences:** T12 pins `dataset_id` + `sha256` from the build
  report and passes the dataset to the sidecar (`initialize` validates
  the hash); T14 scores against the same schema + manifest classes; T15/
  T19 replay from the report's hash. Implemented + tested in
  `agent-desktop/evolution/` (27 tests: SRC/FMT/COV/QL + CLI).

## ADR-019 — T04 hot-fact injection applies the Day-30 decay projection read-time (Redmine #39)

- **Status:** accepted (TASK-7437 / Redmine #39; T04 bugfix on top of
  ADR-012 — backend implements the T06-pinned post-decay projection)
- **Date:** 2026-09
- **Context:** T06 re-run (Redmine #32) pinned hot-fact selection on the
  **post-decay projection** at REF_NOW (spec §10.4): `fact_0005` (hot,
  active, 0.9) is not re-observed for ~62 days → 0.9 → 0.225/stale →
  must NOT be injected. T04 `loadHotFacts` read `core.md` as-is, so a
  session start **before the first consolidation run** injected the
  decayed fact (`['fact_0001','fact_0005','fact_0002','fact_0003']`
  instead of the pinned `['fact_0001','fact_0002','fact_0003']`).
  Backend was asked to decide the contract: (a) apply the decay
  projection inside `loadHotFacts` before selection, or (b) run a decay
  pass before session start.
- **Decision (backend scope):** **(a) — `loadHotFacts` applies the
  §10.4 Day-30 decay projection over `last_observed` before selecting
  hot facts.**
  - The projection is a **pure read-time view** over `core.md`
    (`projectDay30Decay`): importance halved per `decayDays` cycle
    (floor `decayFloor`), `stale` after 2 cycles, hot demoted below the
    hot threshold; selection then uses the projected importance/status.
    Still one file read, no retrieval, no writes, no L2 read — the
    §6.3 "0 ms" contract is preserved.
  - (b) was rejected: running the decay pass at session start would
    mutate `core.md` on a read path, require a full consolidation job
    (LLM judge, L2 reads) at every session start, and violate R-CORE-1
    (core.md written only by consolidation).
  - The projection is deliberately **not** the idempotent decay pass:
    it recomputes from `last_observed` alone (matching the T06 pin in
    `00-fixture-selfcheck`), so it can be *at least as aggressive* as
    the persisted state — never less. The consolidation job (T05) stays
    the authority that persists decay into `core.md`.
  - `MEMORY_DECAY_DAYS` is honored via a `decayDays` option on
    `loadHotFacts`/`injectHotFacts` (default 30); the bridge passes
    `memCfg.decayDays`. `projectDay30Decay` is exported for unit
    testing.
- **Consequences:** T06 row 5 asserts the pinned projection against the
  implementation (suite green for row 5); the fixture `core-hot-max.md`
  now uses spec-valid `fact_<n>` ids so the `MEMORY_HOT_MAX` cap case
  parses (T06 fixture defect fixed in this task); spec §6.3/§10.4
  updated to state the projection.

## ADR-018 — Skill evolution acceptance criteria: quantitative guardrails + done definition (T10)

- **Status:** proposed (TASK-7214 / Redmine #37; T10 — BA acceptance
  criteria for the GEPA skill evolution pipeline, plan #22 T09/T10)
- **Date:** 2026-09
- **Context:** v0.5 evolves `SKILL.md` skills (first `install-dsh`) via
  a GEPA pipeline (Q4: Python sidecar core + Node/TS integration;
  Q5: multi-model judge team). SEC-GEPA-01…11
  (`docs/security-review-memory.md` §5) set the mandatory security
  constraints but not the measurable acceptance thresholds. T11–T15
  need an unambiguous definition of what makes a dataset valid, a
  candidate acceptable, and one evolution round "done".
- **Decision (BA scope, acceptance contract):**
  - **Eval dataset** is valid iff sources are traceable (sandbox test
    or real error log, §4.1), every case is `{context, error, fix}` and
    schema-valid (§4.2), coverage minima are met (`EVAL_MIN_CASES`=20,
    ≥3 per scenario class, every T14 manifest class present, §4.3), and
    there are 0 secret-scan hits (SEC-GEPA-08, §4.4).
  - **Guardrails are quantitative gates**: fitness = 100% on the pinned
    dataset (SEC-GEPA-02), size ≤ 15 KB (SEC-GEPA-03), 0 regressions
    vs base skill on the identical suite (SEC-GEPA-04), 0 hot-swap
    events (SEC-GEPA-05), 2 approvals owner+cto (SEC-GEPA-06), 0
    auto-merge events (SEC-GEPA-07), per-model cost caps with
    all-capped ⇒ pause (SEC-GEPA-09), pinned sidecar deps (SEC-GEPA-10),
    complete + replayable audit trail (SEC-GEPA-11). SEC-GEPA-01
    (isolation) = 0 escape events.
  - **Done for one round** = all merge conditions D-1…D-9 hold (§7.1);
    any reject condition R-1…R-11 ⇒ **rejected — no merge** (§7.2);
    cost-capped runs end as **paused** (R-10).
  - Defaults are env-configurable (`EVAL_*`, `EVOLUTION_*`); the fitness
    floor and size cap are fixed and may not be lowered/raised.
- **Consequences:** T11 builds datasets against §4; T12 gates candidates
  against §5; T13 implements the PR + human-review workflow of §6 with
  the audit trail; T14 makes coverage/fitness measurable; T15/T19 review
  against this contract. Full criteria:
  `docs/skill-evolution-acceptance.md`.
## ADR-017 — GEPA judge team + cost cap (Q5, v0.5)

- **Status:** proposed (TASK-7213 / Redmine #36; T09 GEPA pipeline
  design; reuses ADR-008/ADR-010)
- **Date:** 2026-09
- **Context:** the GEPA LLM-judge (T12) must use the Q5 multi-model
  panel (gpt-4 / gemini-3 / deepseek) with provider abstraction,
  per-model cost caps, and enable/disable config — default DeepSeek
  only, missing keys never block the pipeline. T05 already shipped the
  provider abstraction + cost tracker; T09 fixes how the GEPA judge
  reuses them.
- **Decision (cto scope):**
  - The GEPA judge **reuses the T05 machinery** — `LLMProvider`
    abstraction (`agent-desktop/src/llm-provider.ts`), `CostTracker`
    caps (`src/costs.ts`, `memory/costs-YYYYMM.json`), and the §9.3
    verdict schema — one shared panel config (`JUDGE_PANEL_MODELS`,
    default `deepseek`) across consolidation and evolution.
  - The GEPA judge prompt adds an evolution rubric: **semantic
    preservation** (no drift vs base skill), **diff quality**
    (minimal, reviewable), and **no injection / no instructions**
    (complements SEC-GEPA-08 + the deterministic injection scanner).
    Verdicts are recorded to the run manifest (SEC-GEPA-11) and as L2
    records (R-JUDGE-5) — model + verdict only, never keys.
  - **Single-model fallback (DeepSeek-only) does not block the
    pipeline** (SEC-KEY-03); the only pause is the all-capped state
    (below).
  - **Cost caps (SEC-GEPA-09):** per-model monthly caps shared with
    T05 (defaults DeepSeek $15 / gpt-4 $10 / gemini-3 $10 = $35,
    within the $30–50/month pilot baseline, Q5). Model capped →
    auto-disable for the month (SEC-COST-01); all capped → evolution
    **pauses safely** — no unjudged candidate proceeds, no cap
    override; deterministic guardrails never substitute for the judge.
- **Consequences:** T12 implements the GEPA judge call against the
  shared panel; T10 acceptance criteria and T15 review verify the
  pause/skip behaviour; the owner provides `OPENAI_API_KEY` /
  `GEMINI_API_KEY` to activate the extra modules. Full rationale in
  `docs/gepa-pipeline.md` §6–§7.

## ADR-016 — Fitness gate for `install-dsh` (harness T14, v0.5)

- **Status:** proposed (TASK-7213 / Redmine #36; T09 GEPA pipeline
  design; input to T10/T12/T14)
- **Date:** 2026-09
- **Context:** SEC-GEPA-02/03/04 require quantitative gates (test
  suite 100%, size ≤ 15 KB, semantic preservation). T09 must define
  the fitness function and acceptance threshold for the pilot skill
  `install-dsh` on the Windows Sandbox test-suite harness (T14,
  plan #22 R1/Q3).
- **Decision (cto scope):**
  - **Fitness function:** for candidate `c` over a suite of `N` test
    cases with weights `wᵢ ∈ (0,1]` and binary outcomes `passᵢ`:
    `fitness(c) = (Σ wᵢ·passᵢ) / (Σ wᵢ) ∈ [0,1]`. Default weights are
    uniform; the dataset manifest may weight safety-critical planted
    failures (EFS / junction / service password) higher for
    **ranking** only.
  - **Acceptance threshold:** `fitness = 1.0` (**100% pass**) on the
    full suite (SEC-GEPA-02) + the candidate passes **every test the
    base skill passed** (regression subset, SEC-GEPA-04) + size
    ≤ 15 KB (SEC-GEPA-03) + judge approval (ADR-017). The 100% gate is
    hard — never traded against cost/speed.
  - **Harness modes (Q3):** Mode A = offline harness in the repo/CI
    eval sandbox (used for the evolution loop + gate); Mode B = the
    owner runs the same suite in Windows Sandbox and uploads result
    JSON (merge evidence for T17 + dataset refresh for T11). One
    result schema, one fitness function.
- **Consequences:** T14 packages the suite with the planted failures
  and emits the machine-readable result schema; T12 implements the
  gate; T10/T15 verify. Details in `docs/gepa-pipeline.md` §5.

## ADR-015 — GEPA evolution pipeline: loop, sidecar boundary, guardrails (Q4, v0.5)

- **Status:** proposed (TASK-7213 / Redmine #36; T09 GEPA pipeline
  design; implements SEC-GEPA-01…11 and the ADR-009 boundary)
- **Date:** 2026-09
- **Context:** owner decision Q4 (Redmine #22) = hybrid GEPA stack:
  core (DSPy + GEPA, hermes-agent-self-evolution pattern) as a
  **Python sidecar**, integration infra/tools/deploy **Node/TS
  native**. T02 fixed the security boundary (ADR-009); T09 details
  the functional pipeline.
- **Decision (cto scope):**
  - **Loop (per run `evo_<yyyymmdd>_<seq>`):** dataset prep (T11,
    redacted, SEC-GEPA-08) → GEPA evolution in the sidecar (DSPy
    `Evaluate`/`Reflect`/`Evolve` modules; population
    `EVOLUTION_POPULATION_SIZE`=8, generations
    `EVOLUTION_GENERATIONS`=3, elitism, ~$2–10/run, no GPU) →
    guardrails re-validated in Node (size ≤ 15 KB, test suite 100%,
    semantic preservation — sidecar self-report never trusted) →
    fitness gate (ADR-016) → Q5 judge panel (ADR-017) → branch + PR
    (T13) → human review (owner + cto, **no auto-merge**, no
    hot-swap).
  - **Sidecar boundary (functional, per ADR-009):** sidecar = compute
    worker spawned per run (subprocess over stdio, or pinned
    container); JSON-RPC 2.0, schema-validated, request/response
    only, no command channel/callbacks; data whitelist = dataset +
    base skill + env-less config + job id + scratch dir; never keys /
    git credentials / memory files / host paths. Sidecar runs in the
    disposable SEC-GEPA-01 sandbox (non-root, scratch-only, per-job
    resource + cost limits).
  - **Done/not-done per cycle (contract for T10):** done = dataset
    valid + ≥1 generation + guardrails pass + fitness = 1.0 + judge
    approves + PR open with audit trail (SEC-GEPA-11); rejected when
    any gate fails; paused when the judge panel is all-capped.
  - **Audit trail:** run manifest `evolution/runs/<job_id>/`
    (dataset sha256, sidecar version/digest, config, per-generation
    candidates + guardrail results + verdicts + fitness + final PR) so
    T15/T19 can replay.
- **Consequences:** T11–T15 implement against
  `docs/gepa-pipeline.md`; the JSON-RPC contract and candidate output
  contract are fixed there; `.env.example` gains the `EVOLUTION_*`
  surface. Full design in `docs/gepa-pipeline.md` §3–§5.
## ADR-014 — T08 Telegram bridge: transport abstraction, sandbox-first, command surface

- **Status:** proposed (TASK-6654 / Redmine #34; T08 — backend wires
  memory to Telegram, plan #22 T08/Q1/R7)
- **Date:** 2026-09
- **Context:** T08 must (1) notify the owner on consolidation events
  with the graduation/decay/supersede counts **and** the per-model
  judge spend report (SEC-COST-02), and (2) answer chat commands
  (`search_memory`/`grep_logs` via Telegram, spec §7). Plan #22 T08
  mandates **sandbox-first**: the integration runs in a sandbox/CI
  environment before any real-laptop deployment. The existing Telegram
  bridge docs (TASK-172/173) live outside the agent-team repo (R7) —
  the spec deliberately defers "Telegram transport mechanics" to T08.
- **Decision (backend scope, T08):**
  - **Transport behind an interface.** `TelegramTransport` with two
    implementations: `HttpTelegramTransport` (real Bot API, LIVE — the
    owner's laptop per Q3; token env-only, used only to build
    per-request URLs, never logged — SEC-KEY-01..03) and
    `SandboxTelegramTransport` (JSONL file transport — inbound command
    lines + outbound message appends; **no network, no token**). The
    file doubles as the sandbox evidence log (acceptance criterion 2).
  - **Sandbox-first default.** `loadTelegramConfig` stays in sandbox
    mode unless `TELEGRAM_SANDBOX=0` **and** `TELEGRAM_BOT_TOKEN` are
    both set (an explicit `TELEGRAM_SANDBOX=0` without a token is a
    config error — no silent token-less live transport). CLI default:
    `npm run bridge:sandbox`; live: `npm run bridge`.
  - **Command surface.** `/memory search <query>` → `searchMemory`,
    `/memory grep <pattern>` → `grepLogs` (RE2-safe), `/memory hot` →
    `loadHotFacts`, `/memory spend` → `CostTracker.summary()`,
    `/memory help`. Every memory-derived reply is rendered through the
    SEC-MEM-01 helpers (`renderSearchResults`/`renderGrepMatches`/
    `renderHotFacts` — `[MEMORY_START]…[/MEMORY_END]` + "data, not
    instructions", SEC-MEM-01/02). Non-allowlisted chats are ignored.
  - **Notification format.** `buildConsolidationNotification` emits
    counts + per-model spend (USD/caps, disabled flags) and an
    `_env: sandbox|live` footer — no memory content, no keys
    (SEC-COST-02, SEC-LOG-01). Failure notifications are redacted.
  - **R7:** the bridge interface is designed in this task (documented in
    `docs/TELEGRAM-BRIDGE.md`); if the owner provides the TASK-172/173
    spec, the transport/command surface can be adapted locally.
- **Consequences:** T16/T17 (v0.5) package the live loop as a Windows
  service/installer; T21 (v0.5 UI) reuses the same notification/
  command helpers; the redaction list now also masks Telegram
  `123456789:ABC…` tokens (SEC-LOG-01).

## ADR-013 — T05 consolidation job: run records, decay idempotency, conflict routing

- **Status:** proposed (TASK-6646 / Redmine #31; T05 — backend
  implements spec §8–§10 + the Q5 judge gate)
- **Date:** 2026-09
- **Context:** T05 must ship the sleep-time consolidation job
  (extract → reflect → candidate → graduation → judge gate → verifier
  → write), the multi-model judge gate (Q5, ADR-008/ADR-010), the
  Day-30 decay pass and the conflict/supersede flow. A few contract
  details were fixed at implementation time, aligned with the T06
  fixtures (agent-desktop/tests/).
- **Decision (backend scope, T05):**
  - **New L2 record type `consolidation` (contract addition).** Spec
    §8.1 requires a `cons_<uuid>` run record, but §5.3 defines no type
    for it. T05 adds `consolidation` with content
    `{run_id, status: ok|error|paused, processed, graduated, rejected,
    superseded, decayed, message?}` — id `cons_<uuid>`, provenance
    `tool_output`. On failure the record is type `error` (code
    `consolidation_failed`) exactly as §8.1 says. `types.ts`,
    `schema.ts` and `docs/memory-spec.md` §5.3 are updated.
  - **Cursor + run records live in `memory/consolidation-cursor.json`**
    (`{cursor_ts, last_processed, run_records[]}`); the cursor is
    advanced past the run's own records (re-read after writes) so a
    re-run is idempotent and survives rotation (§5.5). T06 pins the
    file shape.
  - **Decay is idempotent via the L2 `decay` record trail.** The decay
    anchor per fact = `max(last_observed, last decay record ts)`, so a
    fact is decayed once per 30-day cycle; stale (≥ 2 cycles, ≈ 60
    days) facts are skipped and hot facts below
    `MEMORY_HOT_IMPORTANCE` are demoted (`hot_demote`). Nothing is
    deleted (R-MEM-5). No new state file beyond the cursor.
  - **Conflict routing is deterministic.** A candidate whose statement
    token-overlap with an active fact is ≥ `MEMORY_CONFLICT_OVERLAP`
    (default 0.5) is treated as a contradiction and routed through the
    judge-approved **supersede** flow (§10.3): old block `valid_to` +
    `status: superseded`, new block appended, `supersede` L2 record
    linking old→new. `applyConflict` exposes the flow for T06.
  - **Verifier overlap metric = |Q ∩ D| / |Q|** (fraction of candidate
    tokens present in each supporting observation; threshold
    `MEMORY_VERIFY_MIN_OVERLAP` 0.3). This is the "is the statement
    supported by this record" sanity check — deterministic and
    hand-computable for T06 (§10.5.1).
  - **Reflection accepts two shapes.** A pre-shaped lesson
    `{context, error, fix}` is validated and returned (provider output
    used only when parseable — T06 shape test); raw observations
    require the LLM and a parseable response. Reflection records are
    `model_inferred` (§8.3).
  - **Judge helper `judge()` accepts both the native and the T06
    adapter call shapes** (`judge({candidate, providers, ...})` and
    `judge({candidate}, {providers, consensus}, cfg)`).
  - **`MEMORY_CONFLICT_OVERLAP` is a new env knob** (default 0.5) —
    internal tuning for the supersede detector; documented in README
    (not in the spec §11 table).
  - **SEC-LOG-01/SEC-KEY-01..03:** providers send keys only in
    `Authorization`/`x-goog-api-key` headers; logs are redacted via
    `redact.ts`; L2 records store model name + verdict only; the CLI
    reports per-model spend without keys (SEC-COST-02).
- **Consequences:** T06 (already delivered in parallel) asserts the
  graduation rule, verdict schema, consensus/caps with mock providers,
  supersede and decay against this package — verified green against
  the T06 suite (30-consolidation). T08 consumes
  `runConsolidationJob` + `consolidationDue` for the Telegram
  schedule/notifications; T09/T12 (v0.5) reuse `LLMProvider` +
  `CostTracker` for the GEPA judge.

## ADR-011 — T03 core memory module: writer implementation decisions

- **Status:** proposed (TASK-6644 / Redmine #29; T03 core memory module
  — backend implements the T01 data contract)
- **Date:** 2026-09
- **Context:** T03 must ship the append-only L2 writer
  (`sessions.jsonl`) and the L3 writer (`core.md`) per
  `docs/memory-spec.md` §4–§6/§10, plus the SEC-MEM-01 render
  envelope from the T02 security review. Implementation lives in a new
  `agent-desktop/` Node/TS package (Q4: integration infra is Node/TS
  native). A few contract details were fixed at implementation time.
- **Decision (backend scope, T03):**
  - **Rejection vs quarantine audit records.** R-PROV-1 violations
    (missing/invalid `provenance`) are **rejected** and the writer
    appends an `error` audit record; §10.2.1 (no verifiable `source`)
    and §10.2.2 (injection pattern) violations are **quarantined** and
    the writer appends a `quarantine` audit record. Both audit records
    are writer-generated with `provenance: tool_output` and
    `source.kind: tool` (`memory:writer`) — they are valid records per
    §5.2 and readable by T06.
  - **Default field filling.** The writer fills defaults for `id`
    (`evt_<uuid>`), `ts`, `importance` (0.5), `valid_from` (= ts),
    `session_id` (null) when omitted, then validates the completed
    record. `type`, `provenance`, `source`, `content` remain mandatory.
  - **R-CORE-1 enforcement at the API level.** Every mutating `CoreWriter`
    method requires a consolidation context carrying a `cons_<uuid>`
    run id; a live turn/tool cannot construct one (throws
    `ConsolidationOnlyError`). T05 passes its run id.
  - **Rotation naming.** Archives are `sessions-YYYYMMDD.jsonl` (one per
    day, UTC); if the day's archive already exists the current file's
    content is appended to it, then the current file is truncated
    (POSIX `rename` would otherwise silently overwrite an existing
    archive). Rotation is transparent to `readAll()`.
  - **Injection patterns are additive.** `MEMORY_INJECTION_PATTERNS`
    appends to the shipped defaults; a misconfigured deployment cannot
    disable the guardrail by replacing the list.
  - **SEC-MEM-01 at the formatter layer.** `render.ts` owns the
    `[MEMORY_START]…[/MEMORY_END]` envelope + "data, not instructions"
    note; T04 tools must render memory through these helpers.
- **Consequences:** T04 (search/grep tools) consumes `readAll()` and the
  render helpers; T05 (consolidation) drives `CoreWriter` with its
  `cons_<uuid>` run id and writes `supersede`/`decay` L2 records itself;
  T06 can assert the writer contracts (R-PROV-1, quarantine, rotation
  transparency) against this package's tests. The `agent-desktop/`
  package layout is recorded in `ARCHITECTURE.md` §8 (memory subsystem).

## ADR-012 — T04 retrieval tools `search_memory` + `grep_logs` + hot-fact injection

- **Status:** proposed (TASK-6645 / Redmine #30; T04 — backend
  implements spec §7.1/§7.2/§6.3/§7.3 + SEC-MEM-02)
- **Date:** 2026-09
- **Context:** T04 must ship the two retrieval tools, hot-fact
  injection (0 ms), the agentic query budget and the SEC-MEM-02 prompt
  guidance on top of the T03 writer layer. A few contract details were
  fixed at implementation time.
- **Decision (backend scope, T04):**
  - **Similarity = Jaccard on lowercased word tokens**
    (`|Q ∩ D| / |Q ∪ D|`, `\p{L}\p{N}` tokenizer keeping Vietnamese
    diacritics). It is deterministic, bounded [0,1] and hand-computable
    (golden-set testable within 1e-6, spec §13). The `SimilarityFn` seam
    in `retrieval.ts` is the reserved embedding slot (§7.1).
  - **L3 recency uses `last_observed`.** L2 scores recency from `ts`;
    L3 has no `ts`, so `last_observed` (the Day-30 decay driver, §10.4)
    is used — documented in the code and tests.
  - **Weights validated to sum to 1 (hard error).** A misconfigured
    `MEMORY_ALPHA/BETA/GAMMA` that does not sum to 1 throws at config
    load — misconfiguration must not silently change the ranking
    contract (§7.1).
  - **RE2-safe subset for `grep_logs`.** JS's regex engine backtracks,
    so `assertRe2Safe` rejects lookarounds, backreferences and nested
    unbounded quantifiers (`(a+)+`); possessive quantifiers are invalid
    JS and caught by compilation. The subset is deliberately
    conservative (safe-but-unusual patterns may be rejected).
  - **`since` semantics for raw lines.** `grep_logs(since)` filters
    matches whose line timestamp (JSONL `ts` field, else the first ISO
    timestamp in the line) is `>= since`; lines with no determinable
    timestamp are excluded when `since` is set.
  - **Meta counts = returned counts.** `search_memory.meta.hits` and
    `grep_logs.meta.count` equal the number of results/matches returned
    (after `top_k`/`min_score`/`limit`), so T06 can assert them
    directly.
  - **SEC-MEM-02 lives in `src/prompt.ts`.** `MEMORY_TRUST_GUIDANCE` +
    `AGENTIC_RETRIEVAL_PROTOCOL` compose the session-start memory
    section (hot-facts block included, SEC-MEM-01); the same guidance is
    mirrored in `agents/backend/AGENTS.md`. T08 injects
    `buildMemorySystemPrompt(...)` at session start.
  - **Budget is a per-turn tracker, not a mechanism.** `ToolCallBudget`
    (default `MEMORY_MAX_TOOL_CALLS_PER_TURN = 5`) counts calls and
    throws past the cap; per §7.3 the protocol is enforced by the
    caller (bridge/runner) around each turn's tool calls.
- **Consequences:** T06 pins the formula (golden set), the RE2-safe
  rejections and the filter behavior against this package's tests; T08
  consumes `searchMemory`/`grepLogs`/`injectHotFacts`/
  `buildMemorySystemPrompt` for the Telegram bridge; T21 (v0.5) renders
  search results/provenance via the SEC-MEM-01 envelope.

## ADR-010 — Security requirements for the multi-model judge team (Q5)

- **Status:** accepted (TASK-6539 / Redmine #27; T02 security review
  of Q5; supplements ADR-008)
- **Date:** 2026-08
- **Context:** ADR-008 defines the functional contract of the
  multi-model judge panel (gpt-4 / gemini-3 / deepseek). The T02
  security review adds the mandatory security envelope: key custody,
  per-model cost caps, and no secrets in logs/artifacts
  (`docs/security-review-memory.md` §7).
- **Decision (cto scope, security):**
  - **SEC-KEY-01:** API keys live in environment / `.env` (gitignored)
    / compose secrets only — never in memory files, run logs, PR
    bodies, Redmine comments, or artifacts (SECURITY.md class 2).
    `DEEPSEEK_API_KEY` exists; `OPENAI_API_KEY` (gpt-4) and
    `GEMINI_API_KEY` (gemini-3) are pending from the owner and activate
    the corresponding panel modules when present.
  - **SEC-KEY-02:** the `LLMProvider` abstraction loads keys at process
    start and never serializes them; L2-judged records (spec §9.4
    R-JUDGE-5) store model name + verdict only, never keys or full
    prompt echoes.
  - **SEC-KEY-03:** missing keys disable a model (skip, not fail);
    default panel `deepseek` only; no unjudged write ever.
  - **SEC-COST-01/02:** per-model monthly caps (defaults DeepSeek $15 /
    gpt-4 $10 / gemini-3 $10); cap → auto-disable for the month; all
    capped → consolidation/evolution pauses safely; spend reported to
    the owner (T08) without keys.
  - **SEC-LOG-01/02:** judge/reflection path redacts request content
    before logging; secret-scan guard blocks key-shaped strings in
    commits.
- **Consequences:** T05 (consolidation judge) and T12 (GEPA LLM-judge)
  implement the envelope; T06 tests cap/disable behaviour with mock
  providers; T08 reports spend. Full rationale in
  `docs/security-review-memory.md` §7.

## ADR-009 — Q4: Python sidecar (GEPA core) ↔ Node/TS (integration) boundary

- **Status:** accepted (TASK-6539 / Redmine #27; owner decision Q4 in
  Redmine #22; detailed in T09)
- **Date:** 2026-08
- **Context:** the owner decided (Q4) a **hybrid** GEPA stack: the core
  (DSPy + GEPA, as hermes-agent-self-evolution) runs as a **Python
  sidecar**, while integration infra/tools/deploy stay **Node/TS
  native** in agent-team. T02 fixes the security boundary before T09
  details the functional interface.
- **Decision (cto scope, `docs/security-review-memory.md` §6):**
  - **Trust anchor = Node/TS:** it owns git/PRs, the skill registry,
    API keys (env only), and enforces guardrails SEC-GEPA-01…11;
    review gates (T13/T15/T19) live on this side.
  - **Python sidecar = compute worker:** separate process, spawned per
    run, sandboxed (SEC-GEPA-01) with a dedicated non-root user, no
    access to the real workspace, memory files, or credentials.
  - **IPC:** single schema-validated protocol (JSON-RPC over stdio or
    127.0.0.1); request/response only — the sidecar **never initiates
    actions**; no command channel, no callbacks.
  - **Data whitelist:** in = eval dataset, base skill, env-less config,
    job id; out = candidates + fitness + guardrail results + verdicts.
    Never keys, git credentials, memory files, or host paths outside
    the sandbox scratch dir.
  - **Anti-escalation:** capability drop (`no_new_privs`/non-root, no
    inherited secrets), output re-validation in the trusted Node side
    (size/semantic/test gates are not self-reported by the sidecar),
    per-job resource + cost limits, disposable scratch.
- **Consequences:** T09 designs the IPC contract and maps
  SEC-GEPA-01…11; T12/T13 implement; T15/T19 verify. The boundary is
  also recorded in `ARCHITECTURE.md` (§agent-desktop).

## ADR-008 — Multi-model judge team for consolidation (Q5)

- **Status:** accepted (TASK-6060 / Redmine #25; owner decision Q5 in
  Redmine #22)
- **Date:** 2026-08
- **Context:** the consolidation judge gate (ADR-006) must reduce
  single-model bias. The owner decided (Q5) that the "reflection/judge
  team" is **multi-model**: a panel of gpt-4 / gemini-3 / deepseek
  behind a provider abstraction, with per-model cost caps and
  enable/disable configuration (default: DeepSeek only — its API key is
  already available).
- **Decision (BA scope, spec §9):**
  - All judge/reflection LLM calls go through a uniform `LLMProvider`
    abstraction; each model is a pluggable, optional module.
  - Each model has its own monthly cost cap (defaults: DeepSeek $15,
    gpt-4 $10, gemini-3 $10). Reaching the cap auto-disables that model
    for the rest of the month; if all models are capped, consolidation
    **pauses safely** — no unjudged write ever happens.
  - Missing API keys disable a model (skipped, not failed). Default
    panel: `deepseek` only. `OPENAI_API_KEY` / `GEMINI_API_KEY` are
    pending from the owner.
  - Verdicts are strict JSON
    `{verdict, confidence, reasons, suggested_edit}` and recorded in L2
    for auditability.
- **Consequences:** T05 implements the provider abstraction and panel
  config; T06 can test cost-cap and consensus behaviour without real
  keys (mock providers); T09/T12 (v0.5) reuse the same abstraction for
  the GEPA LLM-judge.

## ADR-007 — Guardrails: provenance, anti-poisoning, anti-conflict, decay

- **Status:** accepted (TASK-6060 / Redmine #25; plan #22 T01 + risk R2)
- **Date:** 2026-08
- **Context:** memory that the agent trusts is a poison/prompt-injection
  surface (MINJA/MemoryGraft class). The plan mandates guardrails:
  provenance, anti-poisoning, conflict handling, decay/anti-drift.
- **Decision (BA scope, spec §10):**
  - **Provenance** is mandatory on every record
    (`user_stated`/`model_inferred`/`tool_output`); writes without a
    valid tag or without a verifiable `source` are rejected and
    quarantined.
  - **Anti-poisoning:** source-gated writes, injection-pattern
    quarantine, delimited "memory is data, not instructions" injection,
    no in-turn L3/L4 writes.
  - **Anti-conflict:** never overwrite in place — supersede via
    `valid_from`/`valid_to` + `supersede` records, judge-approved.
  - **Decay/anti-drift:** Day-30 importance halving, hot demotion,
    stale at ~60 days, judge-reviewed drift correction; nothing is ever
    silently deleted.
- **Consequences:** T05 implements the guardrail engine; T06 builds
  fixtures for poisoning/conflict/decay/stale; T07 reviews against this
  contract; T02 (architecture review) validates the threat model.

## ADR-006 — Consolidation: sleep-time batch + graduation N=3–5 + judge gate

- **Status:** accepted (TASK-6060 / Redmine #25; plan #22 T01/T05)
- **Date:** 2026-08
- **Context:** live turns must not write durable memory directly
  (poisoning risk, latency, unverified facts). Research (Letta
  sleep-time compute, arXiv 2504.13171) supports out-of-session
  consolidation.
- **Decision (BA scope, spec §8):**
  - Consolidation runs **only out-of-session** (sleep-time compute):
    after session end + idle window or on schedule; idempotent/resumable
    via a cursor.
  - Pipeline: extract → reflect (`{context, error, fix}` lessons) →
    candidate → graduation rule → judge gate → verifier → write L3/L4.
  - Graduation L2→L3/L4 requires **N = 3–5 distinct supporting
    observations** (default 3, config validated 3..5) **plus judge-gate
    approval**; failures are recorded as `rejection` records.
- **Consequences:** T05 implements the job; T06 tests the graduation
  rule (N<3 → no write) and reflection shape; T08 wires Telegram
  notifications for consolidation events.

## ADR-005 — Retrieval tools `search_memory` + `grep_logs`

- **Status:** accepted (TASK-6060 / Redmine #25; plan #22 T01/T04)
- **Date:** 2026-08
- **Context:** the research concluded that filesystem-based, agentic
  retrieval is sufficient and often better than heavyweight RAG (Letta
  LoCoMo: 74% with filesystem tools alone). v0.4 deliberately avoids a
  vector DB.
- **Decision (BA scope, spec §7):**
  - Two tools: `search_memory` (ranked semantic-ish search over L2+L3)
    and `grep_logs` (raw, unranked regex search over memory files and
    run logs).
  - Retrieval score is **`α·similarity + β·recency + γ·importance`**,
    defaults α=0.5, β=0.3, γ=0.2 (sums to 1; env-configurable);
    similarity is deterministic lexical similarity in v0.4 with an
    embedding slot reserved.
  - Hot facts are injected into the system prompt at session start
    (**0 ms**, file read only); long history is queried agentically,
    turn by turn, under a per-turn call budget.
- **Consequences:** T04 implements the tools; T06 pins the formula with
  golden-set tests; T21 (v0.5) renders search results/provenance.

### ADR-005 addendum — L3 recency anchor is `last_observed`, not `valid_from` (Redmine #40)

- **Status:** accepted (TASK-7438 / Redmine #40; T04 bugfix — pins the
  §7.1 recency anchor per tier; no implementation change —
  `search-memory.ts` already scores L3 on `last_observed`)
- **Date:** 2026-09
- **Context:** spec §7.1 said recency is "exponential or half-life
  decay on `record.ts`" without disambiguating for L3. The T04
  implementation (`search-memory.ts`, `l3Candidate`) uses the L3 fact
  block's `last_observed` as the recency anchor (and as the result
  `ts` and the `since` filter key), which is consistent with the §10.4
  Day-30 decay policy — also keyed on `last_observed`. The T06 re-run
  (Redmine #32) pinned L3 `ts = valid_from` instead (TESTING.md F5,
  `generate-golden.mjs`), so facts whose `valid_from ≠ last_observed`
  scored differently — measured mismatch up to **0.073** (e.g.
  `fact_0001`: impl 0.522009 vs golden 0.448704 at REF_NOW).
- **Decision (backend scope):** L3 recency uses the fact block's
  **`last_observed`** as the anchor. `valid_from` remains the
  validity-window start (§5.4) and is **not** a recency signal: it
  would rank a fact created long ago but re-observed recently as old,
  and a fact never re-observed as recent — diverging from the decay
  policy. Spec §7.1 updated to state the anchor per tier (L2 =
  `record.ts`, L3 = `last_observed`), including the result `ts`,
  `since` filter, tie-break, and §13 acceptance mapping.
- **Consequences:** no change to `search-memory.ts` (it already
  conforms); T06 regenerates the golden set on the pinned anchor
  (Redmine #41) — `generate-golden.mjs` switches L3 `ts` from
  `valid_from` to `last_observed`; `agent-desktop/README.md` already
  documents "L3 recency uses `last_observed`, L2 uses `ts`".

### ADR-005 addendum — search_memory L2 pool is observation-only + provenance_missing audit code (Redmine #42)

- **Status:** accepted (TASK-7805 / Redmine #42; backend bugfix for the
  T06 verify of Redmine #41 — implements the T06-pinned contract, no
  public API change)
- **Date:** 2026-09
- **Context:** T06 verify (Redmine #41, TESTING.md F3/F5 evidence)
  showed `search_memory` scoring **every** L2 record type while the
  pinned contract (spec §7.1 + `generate-golden.mjs`) is
  observation-only: searchable L2 records are those with
  `content.text` (`type: "observation"`). Non-observation records carry
  payloads that can look like text (e.g. a `candidate`'s proposed
  statement, a `rejection`'s `text`), so they ranked and **displaced
  golden observation hits** — measured at rank 3: `evt_…0012`
  (candidate, impl 0.532527) vs `evt_…0015` (observation, golden
  0.526964). Separately, the T03 writer audited every schema rejection
  with the generic `content.code: "schema_invalid"`, while spec §13 row
  1 and fixture `write-attempts.json` att-1 pin the specific
  `provenance_missing` code for R-PROV-1 rejections (write without a
  valid provenance tag).
- **Decision (backend scope):**
  - `search_memory` L2 candidates are filtered by
    `isSearchableL2Record`: `type === "observation"` **and** non-empty
    `content.text`. All other L2 record types (`session_start`,
    `session_end`, `tool_call`, `reflection`, `candidate`, `graduation`,
    `rejection`, `supersede`, `decay`, `hot_promote`/`hot_demote`,
    `quarantine`, `consolidation`, `error`) are administrative/audit
    records — never rankable, never returned. Spec §7.1 + §13 updated to
    pin this.
  - The writer's rejection audit uses `content.code: "provenance_missing"`
    with message `write rejected: provenance is mandatory` when the
    record has no valid provenance tag (R-PROV-1, §4.3/§10.1); all other
    schema failures keep the generic `schema_invalid`.
- **Consequences:** golden-search.json and the T06 suite need no change
  (the golden was already generated on the observation-only pool);
  `10-writer` row 1 and `20-search` rows 6/7 go green on the merged
  implementation. Non-observation records remain fully queryable via
  `grep_logs` (§7.2) — this decision only affects ranked `search_memory`
  results.

## ADR-004 — Memory data contract: `core.md` + `sessions.jsonl`

- **Status:** accepted (TASK-6060 / Redmine #25; plan #22 T01, Q1)
- **Date:** 2026-08
- **Context:** agent-desktop needs a durable, auditable, poison-resistant
  memory format that both DSH agents and a future UI (T21) can consume.
  Plan #22 (Q1) fixes the layout in the agent-team repo under
  `agent-desktop/`.
- **Decision (BA scope, spec §4–§6):**
  - **L2 episodic** = `memory/sessions.jsonl`: JSONL, append-only, one
    record per line with mandatory `id`, `ts`, `type`, `provenance`,
    `source`, `importance`, `valid_from`/`valid_to`.
  - **L3 semantic** = `memory/core.md`: curated Markdown fact blocks
    with a machine-readable metadata block (statement, provenance,
    importance, hot flag, validity window, supporting observations,
    status); written only by consolidation.
  - Mandatory **provenance tag** on every record; timestamps ISO 8601
    UTC; no secrets in memory; size-based rotation of `sessions.jsonl`
    that is transparent to the tools.
- **Consequences:** T03 implements the append-only writer + schema
  validation; T06 validates every line against the schema; T21 renders
  `core.md`/`sessions.jsonl` per this contract.
