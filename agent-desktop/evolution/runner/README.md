# GEPA evolution runner + fitness gate (T12) — agent-desktop v0.5

> **Task:** TASK-9053 / Redmine #47 — T12: GEPA runner + fitness gate
> **Author:** backend (backend@agent-team.local)
> **Contract:** `docs/gepa-pipeline.md` (T09, ADR-015/016/017) ·
> `docs/skill-evolution-acceptance.md` (T10 §5/§7/§8) ·
> `docs/security-review-memory.md` §5 (SEC-GEPA-01…11) + ADR-009/010
> **Consumed by:** T13 (PR workflow) · T15 (reviewer) · T19 (release gate)

This directory implements the **evolution runner** of the GEPA pipeline
v0.5: it runs one evolution run end-to-end

```
eval dataset (T11, pinned sha256)
  → Python sidecar (DSPy+GEPA core, JSON-RPC over stdio — ADR-009)
  → Node guardrail re-validation (SEC-GEPA-01..11)
  → fitness gate (T14 harness — gate(result), ADR-016)
  → multi-model judge team (Q5, ADR-017)
  → audit manifest (SEC-GEPA-11, replayable)
```

**Lesson hermes-agent:** the fitness gate is a **GATE**, not a "better"
measure. It is used to **reject** (100% suite pass + 0 regression vs
base on the SAME dataset), never to self-decide a merge. A candidate is
merge-eligible only when all gates pass + judge approves + (T13) human
review — this runner never merges (SEC-GEPA-06/07).

## Layout

```text
evolution/
├── runner/                        # Node/TS (trust anchor)
│   ├── src/
│   │   ├── config.ts              # EVOLUTION_* env surface (T09 §9)
│   │   ├── sidecar-client.ts      # spawn python + JSON-RPC 2.0 over stdio
│   │   ├── behavior.ts            # candidate SKILL.md → harness behavior (deterministic)
│   │   ├── fitness.ts             # fitness gate: consumes T14 gate(result) + A/B regression
│   │   ├── guardrails.ts          # SEC-GEPA-01..11 re-validation
│   │   ├── judge-team.ts          # Q5 multi-model judge (cost caps, pause)
│   │   ├── manifest.ts            # SEC-GEPA-11 run manifest writer
│   │   ├── run.ts                 # run orchestrator
│   │   └── cli.ts                 # CLI entry
│   └── test/                      # 46 tests (config/guardrails/fitness/judge/manifest/sidecar/e2e)
├── sidecar/                       # Python GEPA core (DSPy+GEPA, hermes pattern)
│   ├── gepa_sidecar/              #   stdlib-only package (protocol/config/lms/modules/evolution)
│   ├── requirements.txt           #   SEC-GEPA-10 pinning (dspy optional)
│   └── tests/                     # 27 unittest tests
└── contracts/
    ├── gepa-rpc.schema.json       # JSON-RPC message schema (T09 §4.3)
    ├── gepa-candidate.schema.json # candidate notification schema (T09 §4.4)
    └── gepa-run-manifest.schema.json  # SEC-GEPA-11 run manifest schema
```

## How to run

From `agent-desktop/`:

```bash
# One evolution run (real sidecar, no keys → MockLM; judge dry-run so
# tests/CI can run without API keys)
EVOLUTION_JUDGE_DRY_RUN=1 \
EVOLUTION_GENERATIONS=1 EVOLUTION_POPULATION_SIZE=3 EVOLUTION_ELITISM=1 \
npm run evolve:run -- --job evo_20260901_001

# With a real judge (DeepSeek default): export DEEPSEEK_API_KEY and do
# NOT set EVOLUTION_JUDGE_DRY_RUN. gpt-4/gemini-3 activate when the
# owner provides OPENAI_API_KEY / GEMINI_API_KEY (Q5, ADR-010).
```

The run writes `evolution/runs/<job_id>/manifest.json` (0600 —
SEC-GEPA-11 audit trail, gitignored).

## Tests

```bash
cd agent-desktop
npm run test:runner     # 46 Node/TS tests (mock providers, harness gate, e2e)
npm run test:sidecar    # 27 Python unittest tests
npm run typecheck:evolution
```

## Security mapping (SEC-GEPA-01…11)

| Requirement | Where T12 satisfies it |
|---|---|
| SEC-GEPA-01 isolation | sidecar spawned per run over stdio only; no command channel; scratch-confined; probe test |
| SEC-GEPA-02 suite 100% | fitness gate consumes T14 `gate(result)` — threshold 1.0 fixed |
| SEC-GEPA-03 size ≤ 15 KB | Node re-measures candidate bytes; cap fixed at 15 360 |
| SEC-GEPA-04 semantic | A/B base vs candidate on the same suite; 0 regressions required |
| SEC-GEPA-05 no hot-swap | runner writes run artifacts only; activation is T13 |
| SEC-GEPA-06 human review | runner never merges; PR + owner/cto approval is T13 |
| SEC-GEPA-07 auto-merge off | no merge code path exists in the runner |
| SEC-GEPA-08 no secrets | T11 secret-scan on dataset + candidate; 0 hits |
| SEC-GEPA-09 cost cap | judge team per-model caps; all-capped ⇒ `paused` (never unjudged) |
| SEC-GEPA-10 pinning | sidecar deps pinned; version recorded in manifest |
| SEC-GEPA-11 audit trail | run manifest schema-validated + replayable |

## Env surface (T09 §9 — see `.env.example`)

`EVOLUTION_SKILL`, `EVOLUTION_DATASET`, `EVOLUTION_BASE_SKILL`,
`EVOLUTION_MAX_SKILL_BYTES` (fixed cap), `EVOLUTION_POPULATION_SIZE`,
`EVOLUTION_GENERATIONS`, `EVOLUTION_ELITISM`, `EVOLUTION_FITNESS_TARGET`
(fixed floor), `EVOLUTION_EVAL_SAMPLE`, `EVOLUTION_RANDOM_SEED`,
`EVOLUTION_RUNS_DIR`, `EVOLUTION_SIDECAR_DIR`, `EVOLUTION_SIDECAR_PYTHON`,
`EVOLUTION_SIDECAR_VERSION`, `EVOLUTION_SIDECAR_TIMEOUT_S`,
`EVOLUTION_SANDBOX_IMAGE`, `EVOLUTION_LM_PROXY_URL`,
`EVOLUTION_LM_PROXY_TOKEN`, `EVOLUTION_JUDGE_DRY_RUN`, plus the shared
`JUDGE_*` panel surface (`JUDGE_PANEL_MODELS`, `JUDGE_CONSENSUS`,
`JUDGE_CAP_*_USD`).

## Traceability

| Artifact | Reference |
|---|---|
| Task | TASK-9053 / Redmine #47 (T12) |
| Design | `docs/gepa-pipeline.md` §3–§9 (ADR-015/016/017) |
| Acceptance | `docs/skill-evolution-acceptance.md` §5/§7/§8 |
| Security | `docs/security-review-memory.md` §5 (SEC-GEPA-01…11) |
| Sidecar boundary | `DECISIONS.md` ADR-009 (Q4) |
| Judge team | `DECISIONS.md` ADR-010 (Q5) + `src/judge.ts`/`llm-provider.ts` (T05) |
| Dependencies | T11 dataset (PR #32) · T14 harness (PR #31) |
