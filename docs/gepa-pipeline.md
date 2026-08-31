# GEPA Pipeline — skill evolution for agent-desktop (v0.5, T09)

> **Status:** proposed (v1.0) · **Author:** cto (cto@agent-team.local)
> **Task:** TASK-7213 / Redmine #36 — T09: Thiết kế pipeline GEPA (DSPy + GEPA Python sidecar; Node/TS tích hợp; SEC-GEPA-01..11 + ADR-009/010; fitness gate install-dsh; cost cap; judge team đa model Q5)
> **Source plan:** Redmine #22 (approved plan; owner decisions Q1–Q7 — note 2026-08-31 16:37 + update 16:48)
> **Security input:** `docs/security-review-memory.md` §5 (SEC-GEPA-01…11), §6 (Q4 boundary), §7 (Q5 judge-team security) — T02, PR #10
> **Decisions:** ADR-009 (Q4 boundary), ADR-010 (Q5 judge-team security), ADR-008 (judge panel), ADR-006 (consolidation), **ADR-015/016/017 (this task)**
> **Project:** agent-desktop (subproject of agent-team) · **Version:** v0.5 Skill Evolution (due 2026-10-30)
> **Consumed by:** T10 (acceptance criteria), T11 (eval dataset builder), T12 (evolution runner + fitness gate), T13 (PR workflow), T14 (eval harness), T15 (reviewer)
> **Last updated:** 2026-09

## 1. Purpose & scope

This document is the **T09 design of the GEPA skill-evolution
pipeline** for `agent-desktop` (v0.5). It specifies:

1. the **evolution loop** (eval dataset → evolution → guardrails →
   PR + human review), following the
   [hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution)
   pattern (DSPy + GEPA — "Reflective Prompt Evolution Can Outperform
   Reinforcement Learning", ICLR 2026 Oral);
2. the **Python sidecar ↔ Node/TS boundary** (owner decision Q4 —
   KẾT HỢP/hybrid): process model, JSON exchange contract,
   permissions, invocation mechanism, and sidecar sandbox;
3. the **fitness gate for skill `install-dsh`** on the Windows Sandbox
   test-suite harness (T14);
4. the **multi-model judge team** (owner decision Q5): provider
   abstraction, per-model cost caps, enable/disable configuration,
   DeepSeek-only default, and the exact **API keys the owner must
   provide**;
5. the **cost cap** integration (SEC-GEPA-09) with the $30–50/month
   pilot baseline;
6. a **1:1 mapping of SEC-GEPA-01…11** to concrete design elements.

Scope boundaries:

- This is a **design** (T09). Implementation is T11–T15. Where a
  component is another task's remit (dataset builder T11, runner T12,
  PR workflow T13, harness T14, review T15), this document fixes the
  **contract** and the **acceptance-relevant numbers** so those tasks
  can implement against it.
- The **security** envelope (isolation, no hot-swap, no auto-merge,
  no secrets, supply-chain pinning, audit trail) is mandatory and was
  fixed by T02 (SEC-GEPA-01…11, ADR-009/010). This design implements
  it; it does not relax it.

## 2. References & inputs

| Input | Where | Used for |
|---|---|---|
| SEC-GEPA-01…11 | `docs/security-review-memory.md` §5 | Mandatory security requirements, §8 of this doc |
| ADR-009 — Q4 sidecar boundary | `DECISIONS.md` | Security boundary of §4 |
| ADR-010 — Q5 judge-team security | `DECISIONS.md` | SEC-KEY/COST/LOG envelope of §6–§7 |
| ADR-008 — multi-model judge panel | `DECISIONS.md`, `docs/memory-spec.md` §9 | Judge contract reused in §6 |
| `docs/memory-spec.md` §8–§10 | T01 spec | L4 skills target format, consolidation lessons, guardrails |
| T05 implementation | `agent-desktop/src/{llm-provider,judge,costs,reflect,verifier,redact}.ts` | Reusable judge-team machinery (§6–§7) |
| Plan #22 Q1–Q7, R1–R7 | Redmine #22 notes | Scope, budget, risk mitigations |
| hermes-agent-self-evolution | NousResearch (DSPy + GEPA) | Evolution-loop pattern (§3) |

## 3. GEPA evolution loop (hermes pattern)

### 3.1 Loop overview

```
        ┌──────────────────────────── Node/TS (trust anchor) ─────────────────────────────┐
        │                                                                                  │
  T11 ──► eval dataset ──► Python sidecar (DSPy + GEPA) ──► candidates ──► guardrails      │
        │      │               evolve population                  │     (Node re-validates)│
        │      │                                                   ▼                       │
        │      │                                          fitness gate (T14 harness)       │
        │      │                                                   │                       │
        │      │                                                   ▼                       │
        │      │                                   LLM-judge panel (Q5, multi-model)       │
        │      │                                                   │                       │
        │      │                                                   ▼                       │
        │      │                                     PASS? ──no──► reject (audit record)   │
        │      │                                                   │yes                    │
        │      │                                                   ▼                       │
        │      │                                   branch + PR → human review (owner+cto) │
        │      │                                                   │                       │
        │      │                                                   ▼                       │
        │      └────────────► merged into skill registry (never auto-merge) ──► next run   │
        └──────────────────────────────────────────────────────────────────────────────────┘
```

One evolution **run** (`evo_<yyyymmdd>_<seq>`) is a job owned by the
Node/TS runner (T12):

| Stage | Owner | Description | Output |
|---|---|---|---|
| 1. Dataset prep | Node + T11 | Build/validate eval dataset from Windows Sandbox tests + real failure logs (redacted, SEC-GEPA-08); compute `dataset_sha256` | `dataset.json` (+ manifest) |
| 2. Evolution | Python sidecar | DSPy + GEPA evolutionary loop over the skill's prompt/instructions: population → reflection → mutation → evaluation → selection, for `GENERATIONS` generations | candidate skills (text) + per-candidate metadata |
| 3. Guardrails | Node (trusted) | Deterministic + semantic gates: size ≤ 15 KB (SEC-GEPA-03), semantic preservation (SEC-GEPA-04), test suite 100% (SEC-GEPA-02) | `guardrail_results` per candidate |
| 4. Fitness gate | Node + T14 harness | Fitness function on the harness results (§5); threshold must be met for PR eligibility | `fitness` score + verdict |
| 5. Judge team | Node + Q5 panel | Multi-model LLM review of the diff / semantic drift / injection (SEC-GEPA-08/09) | verdicts (approve/reject/revise) |
| 6. PR + human review | Node + T13 | Candidate → branch → PR into the skill registry; owner + cto approval; **no auto-merge** (SEC-GEPA-06/07) | PR url |
| 7. Audit | Node | Run manifest (dataset hash, sidecar version, config, per-generation outcomes, final PR) recorded for replay (SEC-GEPA-11) | `runs/<job_id>/manifest.json` |

### 3.2 Evolution stage (Python sidecar, DSPy + GEPA)

The sidecar implements the hermes pattern with three DSPy modules:

1. **`EvaluateModule`** — scores each candidate on the eval dataset
   (or a sampled subset, `EVOLUTION_EVAL_SAMPLE`; the **final** gate
   always uses the full suite — SEC-GEPA-02).
2. **`ReflectModule`** — given the base skill, the dataset, and the
   current candidate + fitness, produces an **error analysis**
   (`{context, error, fix}` — the same shape the T05 reflection uses,
   spec §8.3) that points at what to improve.
3. **`EvolveModule`** — generates the next candidate
   (`evolve_candidate(base, candidate, reflection, history)`) applying
   the GEPA-style reflective mutation: the reflection steers the
   change, the fitness function steers selection.

Loop mechanics (GEPA): maintain a **population** of
`EVOLUTION_POPULATION_SIZE` candidates; per generation, run
evaluate → reflect → evolve → evaluate; keep the top
`EVOLUTION_ELITISM` candidates and replace the rest; stop after
`EVOLUTION_GENERATIONS` generations or when the best candidate
reaches `EVOLUTION_FITNESS_TARGET` (early stop). The sidecar emits
**every** candidate with its self-evaluated metadata to Node; Node
re-runs the deterministic guardrails — the sidecar's self-report is
never trusted (§4.5).

Cost note (plan #22 Q4): a run is **~$2–10** with DeepSeek as the
default judge model and no GPU. Budget accounting in §7.

### 3.3 Definitions: done / not-done for one evolution cycle

(Contract for T10, which will formalize acceptance criteria.)

A cycle is **done (eligible for PR)** when:

- D1 — dataset valid: `dataset.json` passes the T11/T10 dataset
  criteria (sources recorded, no secrets — SEC-GEPA-08, coverage
  ≥ `EVOLUTION_MIN_COVERAGE`).
- D2 — evolution ran ≥ 1 generation (`generations_run ≥ 1`).
- D3 — **guardrails pass**: size ≤ 15 KB (SEC-GEPA-03), test suite
  **100% pass** on the full harness (SEC-GEPA-02), semantic
  preservation vs the base skill (SEC-GEPA-04).
- D4 — **fitness gate met**: `fitness ≥ 1.0` (100% weighted pass
  rate, §5.2) and no regression on the base-skill subset.
- D5 — **judge team approves** (approve by the active panel; revise
  resolves via one regeneration cycle, R-JUDGE-3).
- D6 — PR opened to the skill registry with the full audit trail
  (SEC-GEPA-11); **human (owner) + cto approval** pending — merge is
  never automatic (SEC-GEPA-06/07).

A cycle is **not done / rejected** (never merged) when any of
D3–D5 fails; the rejection is recorded (audit + `rejection` record)
and the next cycle may retry from a fresh seed. A cycle **pauses**
(no unjudged outcome) when the judge panel is all-capped (SEC-GEPA-09
/ SEC-COST-01 — §7.3).

## 4. Python sidecar ↔ Node/TS boundary (Q4, ADR-009)

Owner decision Q4 (Redmine #22): **KẾT HỢP (hybrid)** — the GEPA
**core** (DSPy + GEPA, as hermes-agent-self-evolution) runs as a
**Python sidecar**; integration infra/tools/deploy stay **Node/TS
native** in agent-team. T02 fixed the security boundary (ADR-009);
this section fixes the **functional** boundary T09 must detail.

### 4.1 Split of responsibilities

| Capability | Node/TS (trust anchor) | Python sidecar (compute worker) |
|---|---|---|
| Git / branch / PR / skill registry | ✅ | ❌ (sandbox has no git remote) |
| API keys / credentials | ✅ env-only (SEC-KEY-01) | ❌ (see §4.5; keys never enter the sidecar unless a proxied eval needs them, never persisted) |
| Eval dataset build + redaction (T11) | ✅ | reads the prepared dataset only |
| Evolution loop (DSPy + GEPA) | ❌ | ✅ |
| Guardrail re-validation (size/semantic/test) | ✅ (never trusts sidecar self-report) | emits candidate text + metadata only |
| Fitness evaluation | ✅ (runs the T14 harness) | may compute a *provisional* score for selection only |
| Judge team calls (Q5) | ✅ (reuses T05 machinery) | ❌ (verdicts come from the trusted side) |
| PR creation + human-review workflow (T13) | ✅ | ❌ |
| Filesystem | real workspace (reviewed code only) | sandbox scratch dir only (SEC-GEPA-01) |
| Network | orchestrator / MCP / Redmine / model APIs | model provider API only (or proxied by Node) |

### 4.2 Process & invocation model

- The sidecar runs as a **separate OS process**, **spawned per run**
  by the Node runner (T12) as a subprocess (`spawn("python", ["-m",
  "gepa_sidecar", "--job", ...])`), or as a **pinned container**
  (`SEC-GEPA-10` image) in the repo/CI sandbox. Long-lived service
  mode (localhost JSON-RPC over TCP) is optional; the **default and
  reference mode is per-run subprocess over stdio** (simplest to
  sandbox, disposable, no daemon lifecycle).
- **Sandbox (SEC-GEPA-01):** the sidecar process runs inside the
  disposable eval sandbox — dedicated non-root user / container, no
  network egress to the owner's laptop, no write access to the real
  workspace or real memory files, scratch confined to
  `<sandbox>/scratch/<job_id>/`, everything discarded after the run.
- **Lifecycle:** Node spawns → `initialize` handshake → `evolve`
  job → streamed `candidate` notifications → `finalize` → exit.
  Node applies per-job resource limits (CPU/RAM/time) and a hard
  wall-clock timeout; a hung sidecar is killed and the run fails
  closed (never partially trusted).

### 4.3 JSON exchange contract (IPC)

Transport: **JSON-RPC 2.0 over stdio** (line-delimited) or
`127.0.0.1` TCP. Every message is schema-validated on both sides
(JSON Schema in the repo, `evolution/contracts/*.schema.json`).
**Request/response only; the sidecar never initiates actions** — no
callbacks, no webhooks, no command channel (ADR-009 §6.3).

**Node → sidecar:**

| Method | Params | Purpose |
|---|---|---|
| `initialize` | `{job_id, scratch_dir, dataset_ref, base_skill_ref, config, sidecar_version}` | handshake; validates dataset/base-skill sha256; returns ready |
| `evolve` | (from initialize) | run the evolution loop; emits `candidate` notifications; returns the run report |
| `cancel` | `{}` | cooperative stop between generations (Node may also SIGKILL) |

`config` is **env-less** (no keys, no paths outside scratch):

```jsonc
{
  "population_size": 8,
  "generations": 3,
  "elitism": 2,
  "fitness_target": 1.0,
  "eval_sample": 1.0,
  "max_skill_bytes": 15360,
  "random_seed": 42,
  "judge": { "enabled": true }        // verdicts are NOT produced here — see §4.5
}
```

**Sidecar → Node:**

| Message | Params | Purpose |
|---|---|---|
| `candidate` (notification) | `{candidate_id, generation, skill_text, size_bytes, self_fitness, self_guardrails, reflection}` | every candidate, with self-eval for selection; **Node re-validates** |
| `progress` (notification) | `{job_id, generation, population_best}` | observability |
| `result` (response to `evolve`) | run report: `{job_id, status, generations_run, best_candidate_id, started_at, ended_at, sidecar_version}` | final summary |

**Data whitelist (ADR-009 §6.1):** in = eval dataset (JSON), base
skill text, env-less `EVOLUTION_*` config, job id, scratch dir path.
Out = candidate texts + fitness/guardrail metadata + reflections +
run metadata. **Never:** API keys, git credentials, memory files,
host paths outside the sandbox scratch dir, or free-form "run this
command" payloads.

### 4.4 Candidate output contract (Node re-validation)

The sidecar emits candidates as **text + metadata only**. Node (trust
anchor) re-runs, never trusts sidecar self-report (ADR-009 §6.3.3):

```
candidate = {
  candidate_id: "gen2-05",
  generation: 2,
  skill_text: string,            // SKILL.md body
  size_bytes: int,               // <= EVOLUTION_MAX_SKILL_BYTES (SEC-GEPA-03)
  self_fitness: number|null,     // provisional, selection only
  self_guardrails: {...},        // informational; NOT accepted
  reflection: { context, error, fix } | null
}
```

Node then applies: size check → semantic-preservation check
(SEC-GEPA-04, §8) → full-suite test run (SEC-GEPA-02, §5) → fitness
score (§5.2) → judge panel (Q5, §6). Only a candidate that passes
**all** of these reaches the PR stage (T13).

### 4.5 Anti-privilege-escalation (chống leo thang đặc quyền)

1. **No command channel:** IPC is data-only, schema-validated; the
   sidecar cannot ask Node to execute commands or open files outside
   its scratch dir (ADR-009 §6.3.1).
2. **Capability drop:** non-root, `no_new_privs` equivalent; no
   inherited env secrets. If a sandboxed eval *truly* needs a model
   call from inside the sidecar, Node proxies it (the sidecar gets a
   short-lived, read-only handle to a Node-controlled HTTP forwarder)
   — the sidecar never holds or persists a key (ADR-009 §6.3.2,
   SEC-KEY-01).
3. **Output validation:** SEC-GEPA-02…04 run in the trusted Node
   side / isolated eval, **not** in the sidecar's self-report
   (ADR-009 §6.3.3).
4. **Resource + cost limits:** per-job CPU/RAM/time limits and the
   Q5 cost caps (§7) bound blast radius (ADR-009 §6.3.4).
5. **No persistent state:** scratch discarded after the run; nothing
   the sidecar writes is trusted without re-validation (ADR-009
   §6.3.5).

### 4.6 Sidecar supply chain (SEC-GEPA-10)

- The sidecar image/deps are **pinned** (digest + version) and built
  in CI; `requirements.txt`/`pyproject.toml` are hash-pinned;
  **no `pip install` of unpinned packages at runtime**.
- Sidecar version + image digest recorded in the run manifest
  (SEC-GEPA-11) so T15/T19 can replay with the exact artifact.

## 5. Fitness gate for `install-dsh` (harness T14)

### 5.1 Inputs

- **Base skill:** `skills/install-dsh/SKILL.md` (the current,
  human-approved version in the registry).
- **Test suite (T14 harness):** the Windows Sandbox test suite for
  install-dsh packaged to run in the repo/CI **and** on the owner's
  laptop (plan #22 Q3). It includes the **planted failure cases**
  (EFS encryption, junction handling, service-password handling) plus
  the normal install/idempotency/cleanup paths. The harness emits
  machine-readable results (JSON), so the same fitness function works
  for offline runs (repo/CI) and real Windows Sandbox runs (owner
  uploads results — Q3).
- **Eval dataset (T11):** Context → error → fix lessons built from
  those tests + real failure logs (redacted — SEC-GEPA-08).

### 5.2 Fitness function

For a candidate `c` and a suite of `N` test cases, each with weight
`w_i ∈ (0,1]` and binary outcome `pass_i ∈ {0,1}`:

```
fitness(c) = ( Σ_i w_i · pass_i ) / ( Σ_i w_i )        ∈ [0, 1]
```

- **Weights** default to uniform (`w_i = 1`); the dataset manifest
  may assign higher weights to safety-critical cases (e.g.
  EFS/junction/service-password) for **ranking** purposes. The
  **acceptance** threshold does not depend on weights (§5.3).
- The function is deliberately the simple weighted pass rate —
  identical to "pass rate" when weights are uniform — so T14 can
  implement it deterministically and T15/T19 can verify it by hand.

### 5.3 Acceptance threshold

| Gate | Threshold | Requirement |
|---|---|---|
| Full suite pass | `fitness(c) = 1.0` (i.e. **100% pass**) | SEC-GEPA-02 — any failure → reject |
| Regression subset | candidate passes **every** test the base skill passed | SEC-GEPA-04 — no semantic regression |
| Size | `size_bytes ≤ 15 KB` | SEC-GEPA-03 |
| Judge | active panel approves (Q5) | SEC-GEPA-09 + §6 |

The 100% threshold is a **hard gate** (SEC-GEPA-02); it is not
traded against cost or speed. `EVOLUTION_FITNESS_TARGET` (sidecar
selection target) is `1.0` by default and may be lowered *only for
intra-run selection*; the **PR gate** always requires the full suite.

### 5.4 Harness modes (Q3)

- **Mode A — offline (repo/CI):** the T14 harness runs the suite
  deterministically in the eval sandbox (Linux container running the
  same assertions; Windows-only behaviors simulated/fixtured as
  planted failures). Used for evolution-loop fitness + the 100% gate.
- **Mode B — real Windows Sandbox (owner laptop):** the owner runs
  the same suite in Windows Sandbox and uploads the result JSON
  (Q3). Used as **final evidence before merge** (T17 E2E) and to
  refresh the eval dataset (T11). The fitness function and schema
  are identical, so Mode B results plug straight into the gate.

## 6. Multi-model judge team (Q5)

### 6.1 Panel and provider abstraction

The GEPA LLM-judge reuses the **exact judge machinery built in T05**
(`agent-desktop/src/llm-provider.ts`, `judge.ts`, `costs.ts`) — one
provider abstraction, one cost tracker, one verdict schema (spec §9).
This is required by Q5 ("provider abstraction + cost cap riêng từng
model + module bật/tắt được") and ADR-008/ADR-010.

| Model | Provider | API key | Default state |
|---|---|---|---|
| `deepseek` | DeepSeek (`deepseek-chat`) | `DEEPSEEK_API_KEY` — ✅ **available** | **enabled (default)** |
| `gpt-4` | OpenAI | `OPENAI_API_KEY` — ⏳ **owner must provide** | disabled until key present |
| `gemini-3` | Google (`gemini-3-pro`) | `GEMINI_API_KEY` — ⏳ **owner must provide** | disabled until key present |

- **Enable/disable config:** `JUDGE_PANEL_MODELS` (default
  `deepseek`) — comma-separated, priority order; a model is skipped
  when its key is missing or it is disabled by config
  (SEC-KEY-03 — skip, never fail). GEPA and consolidation share the
  same panel config surface (`agent-desktop/src/config.ts`).
- **Single-model fallback does NOT block the pipeline:** with only
  DeepSeek enabled, its verdict is decisive (R-JUDGE-1); evolution
  proceeds (Q5: "single-model fallback KHÔNG chặn pipeline"). The
  only pause condition is the cost-cap all-capped state (§7.3).

### 6.2 Judge role in the GEPA pipeline

The judge panel reviews each candidate that passed the deterministic
gates (size/test/semantic) before PR eligibility:

- **Prompt content (GEPA-specific, no secrets — SEC-KEY-02):** base
  skill (or its semantic summary), candidate diff, test-suite
  results, and the GEPA rubric: *semantic preservation* (no drift
  from the base skill's intent), *quality of diff* (minimal,
  reviewable), *no injection / no instructions to the agent* (complements
  SEC-GEPA-08 and the deterministic injection scanner).
- **Verdict schema:** reuse spec §9.3
  `{verdict: approve|reject|revise, confidence, reasons, suggested_edit}`.
  `revise` → one regeneration cycle (R-JUDGE-3) then re-judge;
  second revise/reject = reject.
- **Consensus:** `JUDGE_CONSENSUS` (`any` default, `majority`
  optional) — consistent with ADR-008. Verdicts recorded to the run
  manifest (SEC-GEPA-11) and, where applicable, as L2
  `graduation`/`rejection` records (R-JUDGE-5) — model name +
  verdict only, never keys or prompt echoes.

### 6.3 API keys the owner must provide (Q5)

| Key | Needed for | When required |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek judge (default) | ✅ present — stack default |
| `OPENAI_API_KEY` | gpt-4 judge module | ⏳ owner provides → module auto-activates |
| `GEMINI_API_KEY` | gemini-3 judge module | ⏳ owner provides → module auto-activates |

**Behavior when a key is missing:** the corresponding module stays
disabled and is **skipped** (SEC-KEY-03); the panel runs with
DeepSeek only; the pipeline is **not blocked**. **Behavior when all
keys are missing / all models capped:** no enabled judge → the gate
returns `paused`/`error` and evolution **pauses safely** — never an
unjudged write (SEC-COST-01, §7.3). Keys live in env / `.env`
(gitignored) only; never in memory files, logs, PR bodies, Redmine
comments, or artifacts (SEC-KEY-01, SEC-LOG-01/02).

## 7. Cost cap (SEC-GEPA-09)

### 7.1 Budget model (Q5)

Pilot baseline **$30–50/month total** for evolution + consolidation.
Per-model monthly caps (defaults, spec §9.5 — shared with T05):

| Model | Monthly cap (default) |
|---|---|
| `deepseek` | `$15` |
| `gpt-4` | `$10` |
| `gemini-3` | `$10` |
| **Sum** | **$35** — inside the $30–50 baseline |

Caps are env-configurable (`JUDGE_CAP_*_USD`); GEPA and consolidation
share the same per-model accounts (`CostTracker`,
`memory/costs-YYYYMM.json`, spec §9.5). GEPA-specific knobs
(`EVOLUTION_GENERATIONS`, population, sample rate) further bound
per-run spend (~$2–10/run, plan #22).

### 7.2 Model capped → auto-disable

`CostTracker.recordCost` accumulates spend per model per calendar
month; reaching a cap **auto-disables the model for the rest of the
month** (logged — SEC-COST-01). The panel continues with the
remaining models. Spend is reported to the owner without keys
(SEC-COST-02; T08 Telegram report).

### 7.3 All-capped → evolution pause

When **every enabled model is at its cap** (or none is enabled), the
judge gate returns `paused` and the evolution run **pauses safely** —
no unjudged candidate may proceed to PR, no cap override
(SEC-GEPA-09 / SEC-COST-01). The run records the pause reason and
resumes next month or when a key/cap changes; deterministic
guardrails alone never substitute for the judge (guardrail ≠ judge).

## 8. SEC-GEPA-01…11 → design mapping

| # | Requirement (T02) | Design element (this doc) | Where |
|---|---|---|---|
| SEC-GEPA-01 | **Environment isolation** — dedicated sandbox, no egress to laptop, no write to real workspace/memory, disposable per run | Sidecar + eval harness run in the disposable sandbox; dedicated non-root user/container; scratch-only FS; Node enforces the boundary (ADR-009) | §4.2, §4.5 |
| SEC-GEPA-02 | **Test suite 100%** — accepted only on 100% pass of the full suite | Fitness gate: `fitness = 1.0` hard threshold on the T14 harness (Mode A offline / Mode B owner-uploaded) | §5.2–§5.4 |
| SEC-GEPA-03 | **Size guardrail** — candidate `SKILL.md` ≤ 15 KB | `EVOLUTION_MAX_SKILL_BYTES = 15360`; Node re-validates `size_bytes` after the sidecar emits the candidate | §3.3 D3, §4.4, §5.3 |
| SEC-GEPA-04 | **Semantic preservation** — no regression vs base skill | Regression-subset gate (candidate must pass every base-skill test) + judge rubric checks semantic drift | §5.3, §6.2 |
| SEC-GEPA-05 | **No hot-swap** — never swapped into a live session; activation between sessions after merge + approval | Activation only via the skill registry + install script after merge; SEC-BND-01 (install refuses unmerged skills) | §3.3 D6, T13 contract |
| SEC-GEPA-06 | **Human review before merge (T13)** — branch + PR; owner + cto approval | PR workflow (T13): candidate → branch `evolution/<skill>/<candidate-id>` → PR → owner + cto approval | §3.3 D6, §4.1 |
| SEC-GEPA-07 | **Auto-merge forbidden** | No auto-merge path anywhere: CI runs checks but never merges; runner never merges on the agent's behalf; merge is a human action | §3.3 D6, §4.1 |
| SEC-GEPA-08 | **No secrets in candidates/artifacts** | T11 dataset builder redacts tool output before use; injection scanner + judge rubric check candidates; secret-scan guard (SEC-LOG-02) | §3.1 stage 1, §6.2 |
| SEC-GEPA-09 | **Cost cap integration (Q5)** — per-model caps; capped → auto-disable; all-capped → pause | `CostTracker` + panel config shared with T05; all-capped → `paused` (no unjudged write) | §7 |
| SEC-GEPA-10 | **Supply-chain pinning** — sidecar image/deps pinned, built in CI, no unpinned pip at runtime | Digest/version-pinned sidecar artifact; hash-pinned deps; version recorded in run manifest | §4.6 |
| SEC-GEPA-11 | **Audit trail** — dataset hash, verdicts, fitness, guardrail outcomes replayable | Run manifest (`runs/<job_id>/manifest.json`): dataset sha256, sidecar version, config, per-generation candidates + guardrail results + verdicts + fitness + final PR; L2 records | §3.3 D6, §4.6, §6.2 |

## 9. Configuration surface (T12)

Reuses the T05 `agent-desktop/src/config.ts` env surface and adds
the GEPA/evolution block (documented in `.env.example`):

| Env var | Default | Meaning |
|---|---|---|
| `EVOLUTION_SKILL` | `install-dsh` | skill to evolve (registry path) |
| `EVOLUTION_MAX_SKILL_BYTES` | `15360` | SEC-GEPA-03 limit (≤ 15 KB) |
| `EVOLUTION_POPULATION_SIZE` | `8` | GEPA population per generation |
| `EVOLUTION_GENERATIONS` | `3` | max generations per run |
| `EVOLUTION_ELITISM` | `2` | candidates kept per generation |
| `EVOLUTION_FITNESS_TARGET` | `1.0` | intra-run selection target (PR gate always 1.0) |
| `EVOLUTION_EVAL_SAMPLE` | `1.0` | dataset fraction for intra-run eval (final gate uses full suite) |
| `EVOLUTION_MIN_COVERAGE` | `0.8` | dataset coverage criterion (T10/T11) |
| `EVOLUTION_RUNS_DIR` | `<root>/evolution/runs` | audit-trail manifests (SEC-GEPA-11) |
| `EVOLUTION_SANDBOX_IMAGE` | pinned digest | sidecar image (SEC-GEPA-10) |
| `JUDGE_PANEL_MODELS` | `deepseek` | panel priority order (shared, Q5) |
| `JUDGE_CONSENSUS` | `any` | `any` \| `majority` (shared) |
| `JUDGE_CAP_DEEPSEEK_USD` / `_GPT4_` / `_GEMINI3_` | 15 / 10 / 10 | per-model monthly caps (shared, SEC-GEPA-09) |

## 10. Implementation plan handoff (T11–T15)

| Task | Builds | Key contract from this doc |
|---|---|---|
| T10 (ba) | acceptance criteria | §3.3 done/not-done, §5.3 thresholds, §8 mapping |
| T11 (backend) | dataset builder | §3.1 stage 1, dataset schema (Context → error → fix), SEC-GEPA-08 redaction |
| T12 (backend) | evolution runner + sidecar orchestration + fitness gate | §3.2, §4 IPC + candidate contract, §5 fitness function, §7 cost cap |
| T13 (backend) | PR workflow | §3.3 D6, SEC-GEPA-05/06/07 |
| T14 (tester) | eval harness | §5 suite + result schema, Mode A/B |
| T15 (reviewer) | review pipeline + evolved PRs | §8 SEC-GEPA-04/11 replay, §3.3 D3–D5 |

## 11. Open items

- `EVOLUTION_EVAL_SAMPLE` default (1.0) vs cost: if pilot budget
  pressure appears, sampling can be lowered for intra-run selection —
  the final gate stays full-suite (SEC-GEPA-02). Tracked, no change
  required now.
- Mode B (owner-uploaded Windows Sandbox results) timing: needed for
  the **merge evidence** (T17), not for the evolution loop itself.
- Sidecar long-lived service mode (TCP) is optional; per-run
  subprocess is the reference mode (§4.2).

## 12. Sign-off

**Verdict: APPROVE (design).** The T09 design implements all
SEC-GEPA-01…11, keeps the ADR-009 Q4 boundary, and satisfies the Q5
multi-model judge-team requirement (DeepSeek-only default, missing
keys never block, all-capped pauses safely). Recorded as
**ADR-015 (pipeline), ADR-016 (fitness gate), ADR-017 (judge team +
cost cap)** in `DECISIONS.md`; the architecture is recorded in
`ARCHITECTURE.md` §8.3. T10–T15 may implement against this document.

---

## References

- NousResearch, *hermes-agent-self-evolution* (DSPy + GEPA pattern);
  GEPA "Reflective Prompt Evolution Can Outperform Reinforcement
  Learning" (ICLR 2026 Oral) — plan #22.
- `docs/security-review-memory.md` (T02, PR #10) — SEC-GEPA-01…11,
  ADR-009/010.
- `docs/memory-spec.md` (T01, PR #9) — spec §8–§10 (consolidation,
  guardrails), §9 (judge panel contract).
- `agent-desktop/src/llm-provider.ts`, `judge.ts`, `costs.ts`
  (T05, PR #16) — reusable judge machinery.
- Redmine #22 (plan + Q1–Q7), #36 (this task), #37 (T10).
