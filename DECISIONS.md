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
> consolidation job) adds ADR-013. On merge, keep all sets; the
> second PR to merge reconciles the file (trivial append). Per the cto
> ADR-ownership rule (see the TASK-179 version of this file), the cto
> assigns final numbers on merge; working numbers on branches never
> collide because each PR appends its own range.

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
