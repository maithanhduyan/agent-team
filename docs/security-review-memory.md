# Security Review & Threat Model — agent-desktop memory foundation (v0.4) + GEPA boundary (Q4/Q5)

> **Status:** proposed (v1.0, for pm approval) · **Author:** cto (cto@agent-team.local)
> **Task:** TASK-6539 / Redmine #27 — T02 (retry): Architecture & security review
> **Source plan:** Redmine #22 (approved plan, decisions Q1–Q7) — executed by pm in TASK-6026 / Redmine #23
> **Review base:** T01 spec — `docs/memory-spec.md`, `REQUIREMENTS.md`, `DECISIONS.md` ADR-004…ADR-008 (TASK-6060 / Redmine #25, PR #9)
> **Project:** agent-desktop (subproject of agent-team) · **Version:** v0.4 Memory Foundation (due 2026-09-25)
> **Last updated:** 2026-08-31

This document is the **architecture & security review** (plan T02) of the
agent-desktop memory foundation. It validates the T01 threat model
against the data contract and guardrails, records the Q4 (Python
sidecar ↔ Node/TS) and Q5 (multi-model judge team) security decisions,
and defines the security requirements the GEPA pipeline (v0.5, T09)
must implement.

Each review item ends with an explicit verdict:

| Verdict | Meaning |
|---|---|
| **Accept** | Risk is accepted as designed; no change required. |
| **Mitigate** | Risk is mitigated by mandatory guardrails (T01 contract) + the requirements listed here; residual risk tracked. |
| **Reject** | The design/behavior is rejected; must be changed before implementation. |

---

## 1. Scope & method

Reviewed artifacts (from PR #9 / T01 branch, not yet on `develop`):

- `docs/memory-spec.md` — 4-tier memory, data contract (`core.md` +
  `sessions.jsonl`), tool contracts (`search_memory` + `grep_logs`),
  consolidation, judge gate, guardrails (§4–§11).
- `REQUIREMENTS.md` — user stories US-MEM-001…013.
- `DECISIONS.md` ADR-004…ADR-008.
- Plan #22 risks R2 (memory poisoning) and R3 (auto-generated skills),
  owner decisions Q4/Q5.

Review items (per plan T02 and this task's scope):

1. Threat model — memory poisoning (MINJA / MemoryGraft class).
2. Prompt injection via memory content (hot facts / `search_memory`
   results injected into the system prompt).
3. Module boundary: what runs in the agent-team repo vs on the owner's
   Windows laptop; trust levels (R3).
4. Security requirements for the GEPA pipeline (v0.5, consumed by T09).
5. Q4 — Python sidecar ↔ Node/TS boundary (process, data, permissions,
   privilege-escalation resistance).
6. Q5 — multi-model "reflection/judge team" security (key management,
   per-model cost caps, no secrets in logs/artifacts).

---

## 2. Threat model — memory poisoning (MINJA / MemoryGraft class)

### 2.1 Attack techniques (research baseline)

- **MINJA — Memory INJection Attack** (Shen Dong et al., *Memory
  Injection Attacks on LLM Agents via Query-Only Interaction*,
  arXiv:2503.03704, NeurIPS 2025): the attacker cannot directly edit
  the memory bank. Instead they interact through the same surface as
  legitimate users, and craft messages that induce the agent to store
  a **benign-looking record** whose later retrieval as an
  in-context demonstration steers the agent's reasoning (e.g. an
  entity swap `v→t`). Key techniques: *bridging steps* + *indication
  prompt* to get the agent to generate the malicious reasoning trace,
  then *progressive shortening* to strip the overt instruction while
  keeping the malicious payload retrievable.
- **MemoryGraft** (Srivastava & He, *Persistent Compromise of LLM
  Agents via Poisoned Experience Retrieval*, arXiv:2512.16962): an
  indirect injection attack that **does not jailbreak** the agent at
  injection time. The attacker supplies benign ingestion-level
  artifacts; the agent stores them, and retrieval (lexical +
  embedding similarity over "successful experiences") later surfaces a
  small set of **grafted malicious procedure templates** that the
  agent imitates (semantic imitation heuristic) — persistent
  behavioral drift across sessions.

Shared properties relevant to our design:

1. The payload is stored **as data** and only becomes active when
   **retrieved and trusted** later — the memory system is the
   persistence layer of the attack.
2. Both techniques exploit **retrieval-then-imitation**: the agent
   treats remembered content as a trustworthy demonstration.
3. Both are **persistent** (survive sessions) and **stealthy** (the
   stored record looks benign).

### 2.2 Attack paths through our memory stack

Mapped onto the T01 architecture (L1 working / L2 episodic /
L3 semantic / L4 procedural):

| # | Path | Stage | T01 surface | Feasibility |
|---|---|---|---|---|
| P1 | Poisoned `observation` record in `sessions.jsonl` (L2) via a crafted Telegram message / tool output during a live turn | Write (in-turn) | §5.2–5.3 `observation`, source-gated write (§10.2.1) | **High** — the write path is exactly MINJA's "benign-looking record". |
| P2 | Poisoned L2 record graduates to L3 (`core.md` fact) via consolidation + judge gate | Consolidation | §8.4 graduation N=3–5 + judge gate (§9) + verifier (§10.5) | **Medium** — gated, but judge is LLM-based; single-model default is a weak gate. |
| P3 | Poisoned fact becomes `hot` and is injected into every session's system prompt (0 ms) | Injection | §6.3 hot facts; §10.2.3 data-not-instructions wrapper | **High impact** — persistent, system-prompt level. |
| P4 | MINJA-style bridging: attacker asks questions that make the agent store a trace, later retrieved as demonstration for a victim query | Retrieval | §7.1 `search_memory` scoring (α·sim + β·recency + γ·importance) | **High** — retrieval scoring will surface the crafted record for similar queries. |
| P5 | MemoryGraft-style: ingestion artifacts (files/reflections) carry procedure templates that graduation promotes to L4 | Consolidation → L4 | §8.4 L4 graduation target; v0.5 owns evolution | **Medium (v0.4) / High (v0.5)** — L4 is the highest-trust tier. |
| P6 | Conflict/supersede abuse: attacker repeatedly contradicts a fact to force churn or push a poisoned replacement | Consolidation | §10.3 anti-conflict + judge-approved supersede | **Medium** — churn/DoS, not silent takeover. |

### 2.3 Risk assessment (aligned to plan #22, risk R2)

Plan #22 rates **R2 (memory poisoning / prompt injection via memory
content) as Cao/High** — confirmed. Residual-risk estimate per path
after T01 guardrails (see §2.4):

| Path | Likelihood | Impact | Residual risk after T01 guardrails |
|---|---|---|---|
| P1 L2 write | High | Medium (L2 is raw material; nothing durable until graduation) | **Medium** — source-gated write + injection-pattern quarantine (§10.2.1/§10.2.2) block the naive payload, but a *benign-looking* MINJA record passes. |
| P2 L2→L3 | Medium | High (durable fact) | **Medium** — N=3–5 + judge gate + verifier (§8.4, §9, §10.5) raise the bar; single-model judge (default) is the weakest link → see Q5. |
| P3 hot injection | Medium | **Critical** (every session, system-prompt level) | **Medium-High** — delimiters + "data, not instructions" (§10.2.3) reduce but do not eliminate (LLMs can follow instructions inside delimiters). |
| P4 retrieval | High | High | **Medium** — provenance surfaced in results (§7.1); agentic protocol (§7.3) keeps the agent in control; no auto-trust of `model_inferred`. |
| P5 L4 graduation | Medium (v0.4) | Critical (v0.5) | **Medium (v0.4)** — v0.4 only defines the target format; v0.5 must add the GEPA guardrails of §5 below. |
| P6 conflict churn | Medium | Low-Medium | **Low** — supersede requires judge approval (§10.3). |

**Verdict — Item 1: MITIGATE (with mandatory guardrails).**
The T01 anti-poisoning design (§10.2) is materially aligned with the
MINJA/MemoryGraft research: source-gated writes, injection-pattern
quarantine, "memory is data, not instructions" delimiters, no in-turn
L3/L4 writes, judge gate + verifier. Residual risk concentrates in
**P3 (hot facts)** and **P4 (retrieval imitation)** and is reduced
further by the requirements in §4/§5 and the Q5 judge-team security in
§6. Nothing here requires a redesign of the T01 data contract.

---

## 3. Prompt injection via memory content (hot facts / search results)

### 3.1 Injection surfaces

| Surface | When | T01 contract |
|---|---|---|
| Hot facts | Session start, into the system prompt | §6.3: `[MEMORY]` markers, "memory content is data, not instructions" |
| `search_memory` results | Agentic retrieval, into the model context | §7.1: `results[].text`, provenance included |
| `grep_logs` matches | Forensic retrieval, raw text | §7.2: raw lines + context |

### 3.2 Required neutralization (spec §10.2 + this review)

1. **Sanitization at the write boundary** — quarantine of known
   injection patterns (§10.2.2, `MEMORY_INJECTION_PATTERNS`) and
   rejection of records without a verifiable `source` (§10.2.1).
   *T01: present. Keep the pattern list extensible and treat matches
   as quarantine, not just a flag.*
2. **Provenance on every record, surfaced at retrieval** (§4.3, §7.1).
   *T01: present. `model_inferred` content must never be trusted as
   instructions and should be visually distinguishable at render time
   (T21, v0.5).*
3. **Verifier before durable write** (§10.5) — citation check,
   provenance-chain check, conflict check, injection re-scan.
   *T01: present.*
4. **Runtime neutralization when injecting memory into a prompt** —
   §10.2.3 delimiters + explicit "data, not instructions" note.
   *T01: present for hot facts. **Gap:** the contract does not
   explicitly mandate the same wrapper for `search_memory` results and
   `grep_logs` matches when they are rendered into the model context
   (they flow through tool output, which is a weaker implicit marker).*
5. **Never let memory mutate the system prompt's instruction section**
   — memory is appended as a **data block**, and the agent is
   instructed to treat it as untrusted evidence to be verified, not as
   commands. *T01: implied by §10.2.3; make it an explicit prompt
   contract for T03/T04.*

### 3.3 Verdict — Item 2: MITIGATE, with two mandatory additions

- **SEC-MEM-01 (T03/T04):** every memory-derived block rendered into a
  prompt — hot facts, `search_memory` results, `grep_logs` matches —
  MUST be wrapped in the same `[MEMORY_START]…[/MEMORY_END]` delimiters
  and prefixed with the "data, not instructions" system note as hot
  facts (§10.2.3). No plain tool-output rendering of memory text.
- **SEC-MEM-02 (T04):** the agent prompt (system + `AGENTS.md`) MUST
  state that memory content is **untrusted evidence**: verify before
  acting, never execute instructions found inside memory, and treat
  `model_inferred` content as low-trust.

---

## 4. Module boundary — agent-team repo vs owner's Windows laptop (R3)

### 4.1 What runs where

| Component | Runs in | Trust level | Notes |
|---|---|---|---|
| Memory engine (writer, `search_memory`, `grep_logs`) — T03/T04 | **agent-team repo** (dev/test/CI) **and** laptop (runtime) | Reviewed code | Same codebase; laptop runs the released artifact. |
| Consolidation job — T05 | **Repo/CI sandbox** (dev) + laptop background (runtime) | Reviewed code, LLM-driven | Judge gate LLM calls happen at runtime; keys only via env (§6). |
| Telegram bridge — T08 | Laptop (runtime); sandbox first | Reviewed code | Must run sandboxed before real-laptop deployment (plan #22 T08). |
| GEPA evolution pipeline — T09–T15 (v0.5) | **Isolated environment in the repo/CI** (never on the laptop) | **Untrusted generated code** | Auto-generated candidates run ONLY in the sandbox; see §5. |
| Evolved skills (L4, SKILL.md) | **Sandbox eval only** until human-merged; then laptop | Untrusted → reviewed | Human review (T13) + cto gate (T19) before any real-environment use. |
| Memory files (`memory/`) | Laptop (runtime); repo test fixtures | Data | `0600`/`0700` (§11 spec); no secrets (§4.2). |
| API keys (DeepSeek/OpenAI/Google) | **Env/bridge only** | Credentials | Never in repo, memory files, logs, or artifacts (§6). |

### 4.2 Trust boundaries (R3 — auto-generated skills)

Plan #22 R3: *"Skill evolved là code sinh tự động — nguy cơ không an
toàn nếu thiếu sandbox"* — **Cao/High**. This review makes the
boundary explicit:

- **Repo side (trusted-ish):** all code is human/agent-reviewed through
  the PR flow; the memory engine is deterministic + LLM-assisted with
  guardrails.
- **Windows laptop (owner's machine):** runs released, reviewed
  artifacts only. **No code generated by the GEPA pipeline may ever run
  on the laptop before passing the human-review gate (T13) and the cto
  release gate (T19).** In particular, evolved `SKILL.md` content is
  treated as **untrusted until merged**, and even after merge it is
  executed with the standard DSH full-access posture only after the
  owner's explicit approval (plan #22 Q3: the owner runs sandbox tests
  and uploads results).

### 4.3 Verdict — Item 3: ACCEPT (with the boundary above)

The split is consistent with plan #22 (Q1: code in repo; Windows only
`git pull` + install script) and R3 (evolution isolated, human review
mandatory). Tracked as **SEC-BND-01**: the install/update script on the
laptop MUST refuse to deploy any skill not merged through the
human-review workflow (T13) — i.e. no "auto-pull of evolved skills".

---

## 5. Security requirements for the GEPA pipeline (v0.5 — input to T09)

These requirements are the security subset T09 must design against.
Functional design (DSPy+GEPA, fitness gate, dataset) is T09's remit;
**the following are mandatory security constraints**.

| ID | Requirement | Rationale (plan #22 / R3) |
|---|---|---|
| SEC-GEPA-01 | **Environment isolation:** evolution runs in a dedicated sandbox (container/jail) with **no network egress to the owner's laptop, no write access to the real workspace or real memory files**; sandbox is disposable per run. | R3 — generated code must not touch real environment. |
| SEC-GEPA-02 | **Test suite 100%:** a candidate is accepted only if it passes the full eval suite (Windows Sandbox harness, T14) with **100% pass rate** on the current dataset; any failure → candidate rejected. | R3 — behavioral safety floor. |
| SEC-GEPA-03 | **Size guardrail:** candidate `SKILL.md` ≤ 15 KB (plan #22 T09); oversized candidates rejected. | R3 — bounded blast radius, reviewable diff. |
| SEC-GEPA-04 | **Semantic-preservation guardrail:** candidate must preserve the original skill's semantics (no regression vs the base skill on the eval suite); semantic drift → reject. | R3 — evolution must not change behavior silently. |
| SEC-GEPA-05 | **No hot-swap:** evolved skills are NEVER swapped into a live session; activation happens only between sessions after merge + human approval. | R3 + T09 "cấm hot-swap giữa phiên". |
| SEC-GEPA-06 | **Human review before merge (T13):** every evolved candidate goes to a branch + PR into the skill registry; merge requires explicit human (owner) + cto approval. | R3 + plan #22 T13; cto gate T19. |
| SEC-GEPA-07 | **Auto-merge forbidden:** no automated merge of evolved candidates under any circumstance; CI must not auto-merge, and the runner must not merge on the agent's behalf. | R3 + plan T13 "cấm auto-merge". |
| SEC-GEPA-08 | **No secrets in candidates/artifacts:** the evolution dataset and generated candidates MUST NOT contain API keys/tokens; dataset builder redacts tool output before use. | SECURITY.md class 2 (credentials). |
| SEC-GEPA-09 | **Cost cap integration (Q5):** GEPA LLM-judge calls go through the same multi-model provider abstraction with per-model caps (§6); a capped model auto-disables, all-capped → evolution pauses (never unjudged). | Plan #22 Q5/R4. |
| SEC-GEPA-10 | **Supply-chain pinning:** Python sidecar image and its deps are pinned (digest/version) and built in CI; no `pip install` of unpinned packages at runtime. | Hermes-style sidecar, infra hygiene. |
| SEC-GEPA-11 | **Audit trail:** every evolution run records dataset hash, model verdicts, fitness scores, and guardrail outcomes (size/semantic/test) — the T15 reviewer and T19 release gate must be able to replay the run. | T15/T19 reviewability. |

**Verdict — Item 4: MITIGATE (mandatory requirements).** The pipeline
is **not allowed** to run in any mode that bypasses SEC-GEPA-01…11.
T09 must map each requirement to concrete design elements; T12/T13
implement; T14/T15 verify.

---

## 6. Q4 — Python sidecar ↔ Node/TS boundary

Owner decision Q4 (plan #22): **hybrid** — core GEPA = Python sidecar
(DSPy + GEPA, as hermes-agent-self-evolution); integration
infra/tools/deploy = Node/TS native of agent-team. This section fixes
the *security* boundary (the functional interface is detailed in T09).

### 6.1 Process & trust boundary

```
┌────────────────────────── Node/TS (agent-team, trusted) ─────────────────────────┐
│ orchestrator / runner  ── spawns ──►  Python sidecar (GEPA core)                  │
│   • owns git, PRs, skill registry    • DSPy + GEPA (hermes pattern)               │
│   • owns API keys (env only)         • eval dataset → evolution → fitness gate    │
│   • enforces SEC-GEPA-01…11          • generates candidate skills (files/stdout)  │
└───────────────▲───────────────────────────────────────▲──────────────────────────┘
                │  IPC: JSON-RPC / stdio or localhost    │
                │  (single well-defined protocol,        │
                │   schema-validated, no free exec)      │
```

- **Trust:** Node/TS side is the **trust anchor** — it enforces policy
  (guardrails, review, merge) and holds credentials. The Python
  sidecar is a **compute worker** — untrusted-input processor, no
  authority of its own.
- **Process boundary:** sidecar runs as a **separate process** (spawned
  per run), in the sandbox from SEC-GEPA-01, with a **dedicated OS
  user / container** — not root, no access to Node's config, keys, or
  the real workspace.
- **IPC:** one documented protocol (JSON-RPC over stdio or localhost,
  bind to 127.0.0.1, no external exposure); every message
  schema-validated; request/response only — **the sidecar never
  initiates actions** (no callbacks into Node, no webhooks).
- **Data exchanged (whitelist):**
  - In: eval dataset (JSON), base skill text, env-less config
    (`EVOLUTION_*`), job id.
  - Out: candidates (`{skill_text, fitness, size, guardrail_results}`),
    judge verdicts, run metadata.
  - **Never:** API keys, git credentials, memory files, host paths
    outside the sandbox scratch dir, or free-form "run this command"
    payloads.

### 6.2 Permissions per side

| Capability | Node/TS (trusted) | Python sidecar (worker) |
|---|---|---|
| Git / branch / PR | ✅ | ❌ (sandbox has no git remote access) |
| Skill registry write | ✅ (only after human+cto approval, T13) | ❌ |
| API keys / credentials | ✅ (env only, §7) | ❌ (model calls proxied by Node or injected via sandbox env with no persistence) |
| Filesystem | Real workspace (reviewed code only) | Sandbox scratch dir only (SEC-GEPA-01) |
| Network | Orchestrator/MCP/Redmine | Model provider API only (or proxied by Node) |
| Execution of candidates | Sandbox eval harness only | Eval harness inside its own sandbox |

### 6.3 Anti-privilege-escalation (chống leo thang đặc quyền)

1. **No command channel:** the sidecar cannot ask Node to execute
   arbitrary commands or open files outside its scratch dir; IPC is
   data-only, schema-validated.
2. **Capability drop:** sidecar runs as non-root with `no_new_privs` /
   equivalent; no inherited env secrets (keys are never exported into
   the sidecar's environment unless the sandboxed eval truly needs
   them, and never persisted).
3. **Output validation:** candidates are validated by Node
   (SEC-GEPA-02…04) before they can reach a PR; the sidecar cannot
   bypass by crafting output — size/semantic/test gates run in the
   trusted Node/TS harness or an isolated eval, not in the sidecar's
   self-report.
4. **Rate/cost limits:** per-job resource limits (CPU/RAM/time) and the
   Q5 cost caps bound the sidecar's blast radius (SEC-GEPA-09).
5. **No persistent state:** sidecar scratch is discarded after the run;
   nothing it writes is trusted without re-validation.

**Verdict — Item 5 (Q4): ACCEPT the hybrid split** with the boundary
above. Recorded as **ADR-009** (DECISIONS.md) and in `ARCHITECTURE.md`
§agent-desktop. T09 must keep the IPC contract, capability drop, and
output-validation points intact.

---

## 7. Q5 — Multi-model "reflection/judge team" security

Owner decision Q5 (plan #22): judge/reflection LLM calls go through a
**multi-model panel** (gpt-4 / gemini-3 / deepseek) behind a provider
abstraction, per-model cost caps, enable/disable config (default:
DeepSeek only). T01 defined the functional contract (spec §9,
ADR-008). This section adds the **security requirements**.

### 7.1 API key management

| Key | Status | Storage |
|---|---|---|
| `DEEPSEEK_API_KEY` | ✅ available | env / provider config only (already used by the stack) |
| `OPENAI_API_KEY` (gpt-4) | ⏳ **owner must provide** (plan #22) | env only — added when provided |
| `GEMINI_API_KEY` (gemini-3) | ⏳ **owner must provide** (plan #22) | env only — added when provided |

- **SEC-KEY-01:** keys live in environment / `.env` (gitignored) /
  compose secrets — **never** in memory files (`sessions.jsonl`,
  `core.md`), run logs, PR bodies, Redmine comments, or artifacts
  (SECURITY.md class 2).
- **SEC-KEY-02:** the provider abstraction loads keys at process start
  and never serializes them; verdicts recorded to L2 (spec §9.4
  R-JUDGE-5) contain the **model name and verdict only**, never a key
  or a full prompt echo with secrets.
- **SEC-KEY-03:** missing keys disable a model (skip, not fail) — the
  default panel is DeepSeek-only; the pipeline is never blocked by a
  missing key, and never degrades to "unjudged write".

### 7.2 Per-model cost caps

- Defaults from T01 (spec §9.5): DeepSeek $15 / gpt-4 $10 / gemini-3
  $10 per month, within the owner's $30–50/month pilot budget (Q5).
- **SEC-COST-01:** cost is accumulated per model per calendar month
  (persisted in `memory/costs-YYYYMM.json`, outside memory semantic
  content); on cap → model auto-disables for the rest of the month
  (logged); all capped → consolidation/evolution **pauses safely** —
  no unjudged write, no cap override.
- **SEC-COST-02:** spend is reported to the owner (T08 Telegram
  notification) per model; the report must not contain keys.

### 7.3 No keys in logs/artifacts

- **SEC-LOG-01:** the judge/reflection path must redact request
  content before logging; run logs (`agent-runner`, DSH session JSONL)
  never contain keys (SECURITY.md class 2).
- **SEC-LOG-02:** CI + runner config enforce the same redaction; a
  secret-scan guard (repo-level) blocks commits containing key-shaped
  strings for `OPENAI_`/`GEMINI_`/`DEEPSEEK_`.

### 7.4 Verdict — Item 6 (Q5): MITIGATE

The functional contract (T01 §9) plus SEC-KEY-01…03, SEC-COST-01…02,
SEC-LOG-01…02 make the multi-model judge team safe to operate with
DeepSeek today and gpt-4/gemini-3 as soon as the owner supplies keys.
Recorded as **ADR-010** (DECISIONS.md).

---

## 8. Verdict summary

| # | Review item | Verdict | Key guardrails (T01) / requirements |
|---|---|---|---|
| 1 | Memory poisoning (MINJA/MemoryGraft) | **MITIGATE** | §10.2 anti-poisoning, §8.4 graduation, §9 judge gate, §10.5 verifier; residual P3/P4 tracked |
| 2 | Prompt injection via memory content | **MITIGATE** (+ SEC-MEM-01/02) | §10.2.3 delimiters, §4.3 provenance, §7.1 results; require wrapper on all memory renders |
| 3 | Repo ↔ Windows laptop boundary | **ACCEPT** (+ SEC-BND-01) | Plan #22 Q1/R3; no auto-deploy of evolved skills |
| 4 | GEPA pipeline security | **MITIGATE** (SEC-GEPA-01…11) | R3; T09 must implement all 11 requirements |
| 5 | Q4 Python sidecar ↔ Node/TS | **ACCEPT** (ADR-009) | §6 boundary: trust anchor Node, worker sidecar, data-only IPC, no escalation |
| 6 | Q5 multi-model judge team | **MITIGATE** (ADR-010) | SEC-KEY-01…03, SEC-COST-01…02, SEC-LOG-01…02 |

No item is **REJECTED**. All review findings are either already
covered by the T01 contract or are additive requirements
(SEC-MEM-*, SEC-BND-01, SEC-GEPA-01…11, SEC-KEY-*, SEC-COST-*,
SEC-LOG-*) that T03–T05 (memory) and T09–T15 (GEPA) implement.

---

## 9. cto sign-off (enables backend T03–T05)

**Verdict: APPROVE — T01 memory spec (PR #9) is sound for
implementation, with the additive requirements above.**

- The T01 data contract, retrieval contract, consolidation rules and
  guardrails (§4–§11) are consistent with the MINJA/MemoryGraft threat
  model and the plan #22 decisions (Q1–Q7, R2, R3).
- Backend tasks **T03, T04, T05 may start** once pm approves this
  document and PR #9 merges, with SEC-MEM-01/02 folded into T03/T04
  and the §5/§6/§7 requirements feeding T05's judge-gate work and
  T09's design.
- The Q4 boundary (ADR-009) and Q5 security (ADR-010) are recorded in
  `DECISIONS.md`; the architecture is recorded in `ARCHITECTURE.md`.
- This review is the input contract for **T09** (GEPA design): T09 must
  implement SEC-GEPA-01…11 and keep the Q4 boundary.

---

## 10. References

- Shen Dong et al., *Memory Injection Attacks on LLM Agents via
  Query-Only Interaction* (MINJA), arXiv:2503.03704 (NeurIPS 2025).
- Srivastava & He, *MemoryGraft: Persistent Compromise of LLM Agents
  via Poisoned Experience Retrieval*, arXiv:2512.16962.
- Letta (sleep-time compute), arXiv:2504.13171 (cited in T01 spec).
- NousResearch, *hermes-agent-self-evolution* (DSPy + GEPA pattern),
  and GEPA "Reflective Prompt Evolution Can Outperform Reinforcement
  Learning" (ICLR 2026 Oral) — cited in plan #22.
- Plan: Redmine #22 (Q1–Q7, R1–R7) · Execution: #23 · T01: #25 ·
  T02 (this task): #27 (retry of #26).
