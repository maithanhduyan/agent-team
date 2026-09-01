# Requirements — agent-desktop memory foundation (v0.4)

> **Status:** proposed (v1.0) · **Owner:** Business Analyst (ba)
> **Task:** TASK-6060 / Redmine #25 — T01: Spec bộ nhớ 4 tầng + data
> contract + guardrails (requirement ticket for the agent-desktop
> v0.4 Memory Foundation milestone)
> **Project:** agent-desktop (subproject of agent-team) · **Version:**
> v0.4 Memory Foundation (due 2026-09-25)
> **Last updated:** 2026-08-31

This document is the **requirements view** of the memory foundation. The
technical contract (schemas, tool signatures, formulas, guardrail
mechanics) lives in **`docs/memory-spec.md`** — this file states *what*
the product must do (user stories + measurable acceptance criteria) and
points to the spec for *how*. Related documents: `docs/memory-spec.md`
(contract), `DECISIONS.md` (ADRs, incl. the Q5 multi-model judge team).

> **Merge note:** this PR introduces `REQUIREMENTS.md`/`DECISIONS.md`
> on `develop`, where they do not yet exist. PR #8 (TASK-180, demo
> skeleton requirements) also introduces these files. Whichever merges
> second must reconcile (trivial append — see also the note in the
> TASK-180 version of this file).

## 1. Purpose and scope

`agent-desktop` runs DSH on the owner's Windows laptop with a Telegram
bridge. For the agent to be useful across sessions it needs **long-term
memory**: it must remember who the owner is, what they prefer, what
happened in past sessions, and what it learned (procedures) — and it
must do so **safely** (no memory poisoning, no silent contradictions,
no unbounded drift).

**In scope for v0.4 Memory Foundation:**

1. Four-tier memory: **L1 working** (context/hot facts) · **L2
   episodic** (`sessions.jsonl`, append-only) · **L3 semantic**
   (`core.md`) · **L4 procedural** (skills — graduation target defined;
   evolution itself is v0.5).
2. Data contract: `core.md` + `sessions.jsonl` schemas, standard record
   format, mandatory **provenance tag**
   (`user_stated` / `model_inferred` / `tool_output`).
3. Tools `search_memory` + `grep_logs` with the retrieval score formula
   `α·similarity + β·recency + γ·importance`; hot-fact injection at
   session start (0 ms); agentic turn-by-turn querying of long history.
4. Consolidation: out-of-session batch job (sleep-time compute);
   graduation L2→L3/L4 after **N = 3–5 observations + judge gate**.
5. Guardrails: provenance enforcement, anti-poisoning (block writes
   with no origin, injection-pattern quarantine), anti-conflict
   (`valid_from`/`valid_to`, supersede), decay/anti-drift (Day-30).
6. **Q5:** the judge gate is a **multi-model "reflection/judge team"**
   — panel gpt-4 / gemini-3 / deepseek behind a provider abstraction,
   per-model cost caps, optional module (default: DeepSeek only, key
   already available).

## 2. User stories

### 2.1 Memory persistence (4 tiers)

#### US-MEM-001 — Long-term memory across sessions

> **As the owner**, I want the agent to remember facts, preferences and
> session history across restarts and new chats, so that I do not have
> to repeat myself in every session.

**Acceptance criteria:**

- AC-1: Memory is organized in four tiers L1–L4 as defined in
  `docs/memory-spec.md` §3.
- AC-2: `memory/sessions.jsonl` (L2) is append-only JSONL; every line is
  a valid record per the schema (§5.2 of the spec).
- AC-3: `memory/core.md` (L3) contains curated fact blocks per the
  schema (§6.2 of the spec).
- AC-4: A fact recorded in one session is retrievable in a later,
  separate session via `search_memory`.
- AC-5: No data is silently deleted: corrections and conflicts create
  new records with `valid_to` on the old ones (spec §10.3).

#### US-MEM-002 — Provenance on every record

> **As the owner and the reviewer**, I want every memory record to say
> where it came from (`user_stated` / `model_inferred` / `tool_output`),
> so that I can trust what the agent remembers and audit it.

**Acceptance criteria:**

- AC-1: Every record written to L2/L3 carries exactly one valid
  `provenance` tag (spec §4.3).
- AC-2: A write attempt without a valid provenance value is **rejected**
  (no partial line; an error/quarantine record is written).
- AC-3: `model_inferred` records never reach L3/L4 without passing the
  judge gate.
- AC-4: The memory viewer (T21, v0.5) and `search_memory` results expose
  the provenance of each record.

### 2.2 Retrieval

#### US-MEM-003 — Search memory with ranked results

> **As the agent**, I want to query memory by meaning and get ranked,
> relevant records, so that I can ground my answers in past facts and
> sessions.

**Acceptance criteria:**

- AC-1: `search_memory(query, …)` returns records ranked by
  `score = α·similarity + β·recency + γ·importance` with defaults
  α=0.5, β=0.3, γ=0.2 (spec §7.1).
- AC-2: Only active records are returned by default (`valid_from <= now
  <= valid_to`); `include_expired` opt-in.
- AC-3: Results respect `top_k` and `min_score`; filters (`layers`,
  `provenance`, `since`, `session_id`) behave as specified.
- AC-4: The score formula matches a hand-computed golden set within
  1e-6 (deterministic output — testable by T06).
- AC-5: Empty query or unknown layer → explicit error; no matches →
  empty results (not an error).

#### US-MEM-004 — Grep logs for raw evidence

> **As the agent**, I want to search the raw memory files by exact
> pattern, so that I can verify facts, inspect raw context and follow
> leads across long histories.

**Acceptance criteria:**

- AC-1: `grep_logs(pattern, …)` returns unranked matching lines with
  optional context, in file/line order, capped by `limit` (spec §7.2).
- AC-2: Regex is RE2-safe; invalid regex → error.
- AC-3: `files: "memory"` searches `sessions.jsonl` (+ archives) and
  `core.md`; `"runs"` searches DSH run logs; `"all"` searches both.

#### US-MEM-005 — Hot facts injected instantly

> **As the owner**, I want the agent to already know my key preferences
> at the start of every session without any query, so that responses are
> personalized from the first message.

**Acceptance criteria:**

- AC-1: Hot facts (`hot: true`, active, `importance ≥ 0.8`) are injected
  into the system prompt at session start — **0 ms retrieval** (file
  read only) (spec §6.3, §7.3).
- AC-2: At most `MEMORY_HOT_MAX` (default 10) hot facts are injected,
  ordered by importance.
- AC-3: Injected memory is delimited and explicitly marked as **data,
  not instructions** (anti-poisoning, spec §10.2.3).

#### US-MEM-006 — Agentic querying of long history

> **As the agent**, I want to query long history iteratively (turn by
> turn) instead of dumping everything into context, so that I stay
> within context budget while still finding what I need.

**Acceptance criteria:**

- AC-1: The system does not auto-load full session history into
  context; retrieval happens via `search_memory`/`grep_logs` calls
  (spec §7.3).
- AC-2: A per-turn query budget exists (`MEMORY_MAX_TOOL_CALLS_PER_TURN`,
  default 5).

### 2.3 Consolidation

#### US-MEM-007 — Out-of-session consolidation

> **As the owner**, I want the agent to digest session history in the
> background (not while I am chatting), so that my chats stay fast and
> memory is organized between sessions.

**Acceptance criteria:**

- AC-1: Consolidation runs only out-of-session (sleep-time compute):
  after session end + idle window, or on schedule (spec §8.1).
- AC-2: Live turns never write to L3/L4 and never trigger
  consolidation.
- AC-3: Consolidation is idempotent/resumable (cursor survives restarts
  and file rotation).

#### US-MEM-008 — Graduation with judge gate

> **As the owner**, I want the agent to only promote well-supported
> observations into durable memory, so that one-off remarks or guesses
> do not become permanent "facts".

**Acceptance criteria:**

- AC-1: A candidate graduates L2→L3/L4 only when it has **N = 3–5
  distinct supporting observations** (default 3, config validated to
  3..5) **and** judge-gate approval (spec §8.4).
- AC-2: Failed candidates are recorded as `rejection` records with a
  reason and are **not** written to L3/L4.
- AC-3: Graduated facts record `observation_count` and
  `supporting_observations` so the rule is directly assertable by T06.

#### US-MEM-009 — Reflection compresses lessons

> **As the owner**, I want the agent to learn from failures as
> "context → error → fix" lessons, so that it gets better at recurring
> tasks (e.g. the install-dsh procedure on my EFS-encrypted laptop).

**Acceptance criteria:**

- AC-1: Reflection records have the `{context, error, fix}` shape
  (spec §8.3).
- AC-2: Reflections are `model_inferred` and subject to the judge gate
  before graduation.

### 2.4 Multi-model judge team (Q5)

#### US-MEM-010 — Multi-model judge gate with cost control

> **As the owner**, I want the judge gate to use a panel of models
> (gpt-4 / gemini-3 / deepseek) with per-model cost caps and the ability
> to enable/disable each model, so that judging is less biased and I
> control spending (default: only DeepSeek, whose key I already have).

**Acceptance criteria:**

- AC-1: Judge/reflection LLM calls go through a **provider abstraction**
  with a uniform interface; each model is a pluggable module (spec §9.2).
- AC-2: Each model has its own monthly cost cap; on reaching the cap the
  model auto-disables for the rest of the month (spec §9.5).
- AC-3: Models without an API key are skipped, not failures; default
  panel is `deepseek` only; **no unjudged write ever happens** — if all
  models fail/capped, consolidation pauses safely.
- AC-4: Judge verdicts are strict JSON
  `{verdict: approve|reject|revise, confidence, reasons, suggested_edit}`
  and are recorded in L2 for auditability (spec §9.3).
- AC-5: Multi-model consensus rules (`any` / `majority`) work as
  specified (spec §9.4).

### 2.5 Guardrails

#### US-MEM-011 — No memory poisoning

> **As the owner**, I want the agent to refuse to store unverifiable or
> manipulative content in memory, so that nobody can hijack the agent by
> planting instructions in remembered text.

**Acceptance criteria:**

- AC-1: Writes with no verifiable `source` are rejected and
  quarantined (spec §10.2.1).
- AC-2: Text matching known prompt-injection patterns is quarantined
  and never reaches L3/L4 (spec §10.2.2).
- AC-3: Memory content injected into prompts is delimited and marked as
  data, not instructions (spec §10.2.3).

#### US-MEM-012 — No silent contradictions

> **As the owner**, I want the agent to handle changing facts without
> silently overwriting what it knew, so that memory stays consistent and
> auditable over time.

**Acceptance criteria:**

- AC-1: A new fact contradicting an active fact supersedes it: old
  `valid_to` set, new block appended, `supersede` record written — no
  in-place overwrite (spec §10.3).
- AC-2: The judge gate sees conflicting active facts and must approve
  the supersede.

#### US-MEM-013 — Memory decays instead of drifting

> **As the owner**, I want stale memories to fade (importance decay) and
> be flagged rather than persist forever as if current, so that the
> agent does not act on outdated facts.

**Acceptance criteria:**

- AC-1: A fact not re-observed for `MEMORY_DECAY_DAYS` (default 30) has
  its importance halved and a `decay` record written (spec §10.4).
- AC-2: Hot facts below the hot threshold are demoted; stale facts
  (≈ 60 days) are excluded from hot injection and deprioritized in
  search.
- AC-3: Drift is corrected: consolidation re-checks active facts
  against recent observations and flags unsupported ones for judge
  review — nothing is silently deleted.

## 3. Non-functional requirements

- **Performance:** hot-fact injection 0 ms; `search_memory` ≤ 500 ms;
  `grep_logs` ≤ 1 s on a 100 MB store; consolidation run ≤ 5 min for a
  day of sessions (spec §11).
- **Cost (Q5):** judge-team per-model caps default
  DeepSeek $15 / gpt-4 $10 / gemini-3 $10 per month; owner baseline
  $30–50/month total for evolution + consolidation.
- **Security:** memory files never contain secrets; memory directory
  permissions 0700/0600 (spec §11).
- **Reliability:** append-only writer; a corrupted tail line never
  breaks reads (skip + log).
- **Verifiability:** every user story above maps to testable acceptance
  criteria and to T06 fixtures (spec §13).

## 4. Out of scope (v0.4)

- Vector store / embeddings / knowledge graph (slot reserved in spec
  §7.1).
- GEPA skill evolution, skill registry + PR workflow (v0.5, T09–T15).
- Memory UI (v0.5, T21).
- Telegram transport mechanics (T08 — consumes these contracts).
- Multi-user memory separation.

## 5. Gaps, risks and open questions

1. **OpenAI / Google keys (Q5).** The multi-model panel degrades to
   single-model DeepSeek until the owner provides `OPENAI_API_KEY` and
   `GEMINI_API_KEY`. Design is in place (spec §9); pipeline is not
   blocked (US-MEM-010 AC-3).
2. **Similarity metric choice.** v0.4 uses a deterministic lexical
   similarity; embedding-based similarity is a reserved slot (spec
   §7.1). T06 golden-set tests must pin the chosen metric.
3. **`core.md` concurrent writers.** Only consolidation writes L3
   (R-MEM-2); the writer must take an exclusive lock during fact-block
   appends to avoid torn writes.
4. **Recurring vs one-off procedures.** L4 graduation from L2 requires
   the same N + judge gate; distinguishing "procedure" from "fact" is a
   heuristic — flagged for T02/T09 review.
5. **Shared files with PR #8.** `REQUIREMENTS.md`/`DECISIONS.md` are
   introduced by both this PR and PR #8 (TASK-180); the second merge
   must reconcile (see merge note above).

## 6. Traceability

| Artifact | Reference |
|---|---|
| Task | TASK-6060 / Redmine #25 (T01 — spec memory + data contract + guardrails) |
| Source plan | Redmine #22 (Q1–Q7) + #23 (pm execution), version v0.4 Memory Foundation |
| Contract | `docs/memory-spec.md` (this PR) |
| Downstream tasks | T02 [cto] review → T03/T04/T05 [backend] → T06 [tester] → T07 [reviewer] → T08 [backend] Telegram |
| Decisions | `DECISIONS.md` ADR-004 … ADR-008 (this PR) |
| Redmine | Issue #25 + project agent-desktop, version v0.4 Memory Foundation |

---

## 7. v0.5 Skill Evolution (GEPA) — acceptance criteria (T10)

> **Task:** TASK-7214 / Redmine #37 (T10 — acceptance criteria cho skill
> evolution) · **Status:** proposed (T09 design #36 in progress) ·
> **Version:** v0.5 Skill Evolution (due 2026-10-30)

The v0.5 milestone evolves `SKILL.md` skills (first: `install-dsh`)
through a GEPA pipeline (plan #22 Q4/Q5): eval dataset → evolution →
guardrails → PR + human review. The full acceptance criteria — eval
dataset validity, quantitative guardrails SEC-GEPA-01…11, PR + human
review workflow, and the definition of "done" for one evolution round —
are specified in **`docs/skill-evolution-acceptance.md`** (T10, this
PR). Requirements view:

- **User stories:** US-SKILL-001 (evolve from real failures),
  US-SKILL-002 (evolve safely — guardrails), US-SKILL-003 (humans
  approve every evolved skill), US-SKILL-004 (know exactly when a round
  is done) — see `docs/skill-evolution-acceptance.md` §3.
- **Definition of "done" (merge-ready):** dataset valid → evolution run
  ok → fitness = 100% (SEC-GEPA-02) → no regression (SEC-GEPA-04) →
  all guardrails pass → PR with full metadata → owner + cto approval
  (SEC-GEPA-06) → human merge (SEC-GEPA-07) → activation between
  sessions (SEC-GEPA-05). Any reject condition (§7.2 of the acceptance
  doc) ⇒ **rejected — no merge**.
- **Downstream:** T11 eval dataset builder → T12 GEPA runner + fitness
  gate → T13 evolved-skill PR workflow → T14 Windows Sandbox harness →
  T15 review → T19 release gate. **Trạng thái (2026-09, ADR-020/024):**
  T09–T14 merged — T11 (PR #32), T14 (PR #31), T12 (PR #34,
  `99194d2`), T13 (PR #35, `c8ffb74`) đều trên `develop`; **T15**
  (reviewer, Redmine #53, TASK-9692) đang chạy — review code pipeline
  GEPA (semantic preservation, size ≤15 KB, regression check); chưa có
  skill evolved nên chưa review skill PR (vòng pipeline thật sau T17).
  T16–T21 deferred chờ T15 xong.
- **Decisions:** `DECISIONS.md` ADR-009/010 (existing) + ADR-015 (this
  PR) + ADR-020/021/022 (T11/T12/T13) + ADR-023 (Q5) + ADR-024 (SÓNG 2b
  closure).
