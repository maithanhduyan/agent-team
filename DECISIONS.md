# Decisions (ADR)

Architecture and scope decisions are recorded here as short ADRs, in
reverse chronological order. Add a new entry whenever a public contract,
the project architecture, or the product scope changes.

> **Note on ADR numbering:** this file is introduced on `develop` by two
> PRs in parallel — PR #8 (TASK-180, demo skeleton requirements) carries
> ADR-001…ADR-003, this PR (TASK-6060, memory foundation) carries
> ADR-004…ADR-008. On merge, keep both sets; the second PR to merge
> reconciles the file (trivial append).

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
