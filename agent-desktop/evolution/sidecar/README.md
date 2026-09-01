# GEPA evolution sidecar — Python core (T12, ADR-009)

> **Part of:** `agent-desktop/evolution` — GEPA skill evolution (v0.5)
> **Consumed by:** `runner/` (Node/TS trust anchor — spawns this per run)

The **compute worker** of the GEPA pipeline: implements the
hermes-agent-self-evolution pattern (DSPy + GEPA) as a separate process
spawned per run by the Node/TS runner, communicating over **JSON-RPC
2.0 over stdio** (`docs/gepa-pipeline.md` §4, ADR-009).

## Security posture (SEC-GEPA-01..11 / ADR-009)

- **Trust anchor is Node/TS.** This sidecar is a worker with no
  authority: no git, no keys, no memory files, no host paths outside
  the scratch dir.
- **No API keys.** The sidecar never holds a key. A real LM call (when
  configured) goes through a **Node-controlled HTTP forwarder**
  (`lm_proxy_url` + short-lived `lm_proxy_token` from the `initialize`
  params — ADR-009 §6.3.2); without it the deterministic `MockLM` runs
  the same loop offline (tests / CI / no-key mode, SEC-KEY-03).
- **Env-less config.** The `config` block carries only numeric/string
  knobs; the token travels as a separate param and is never recorded
  (SEC-KEY-02).
- **Self-reports are never trusted.** `self_fitness`/`self_guardrails`
  are informational for intra-run selection; the Node side re-runs all
  deterministic gates (ADR-009 §6.3.3, CG-2).
- **Stdlib-only runtime.** `gepa_sidecar/` imports no third-party
  packages — the pinned sandbox image runs offline and there is never
  a runtime `pip install` (SEC-GEPA-10). DSPy is an *optional*
  backend pinned in `requirements.txt` for the production image.

## Modules (hermes pattern, T09 §3.2)

| Module | Role |
|---|---|
| `modules.py` `EvaluateModule` | scores a candidate on the dataset (self-eval for selection) |
| `modules.py` `ReflectModule` | error analysis `{context, error, fix}` (spec §8.3 shape) |
| `modules.py` `EvolveModule` | next candidate from (base, candidate, reflection, history) |
| `evolution.py` `GepaEvolution` | population loop: evaluate → reflect → evolve → select (elitism), early stop on fitness target |
| `lms.py` | `MockLM` (deterministic, offline) / `ProxyLM` (Node forwarder) |
| `protocol.py` | JSON-RPC 2.0 line-delimited framing (stdlib) |
| `config.py` | env-less config parse/validate (falls back + warns) |
| `__main__.py` | `python -m gepa_sidecar --job <id> [--scratch <dir>]` |

## Protocol (T09 §4.3)

Lifecycle per run: `initialize` (validates dataset/base-skill sha256,
version handshake) → `evolve` (streams `candidate` + `progress`
notifications, returns the run report) → `cancel` (cooperative stop) →
EOF/exit. Request/response only — the sidecar never initiates actions.

## Run

```bash
# From the sidecar dir (spawned by the runner; not run by hand normally)
python3 -m gepa_sidecar --job evo_20260901_001 --scratch /tmp/scratch

# Version check
python3 -m gepa_sidecar --version
```

## Tests

```bash
cd agent-desktop/evolution/sidecar
python3 -m unittest discover -s tests -v     # 27 tests
```

Covered: config validation (incl. SEC-GEPA-03 ceiling + token never
serialized), JSON-RPC framing (parse/error/notification), the GEPA loop
(determinism, cancel, size bound), and the full stdio CLI lifecycle
(initialize/evolve/cancel, sha256 mismatch rejections, version
handshake).

## Traceability

| Artifact | Reference |
|---|---|
| Task | TASK-9053 / Redmine #47 (T12) |
| Design | `docs/gepa-pipeline.md` §3.2/§4 (ADR-015) |
| Security | `docs/security-review-memory.md` §5/§6 (SEC-GEPA-01..11, ADR-009) |
| DSPy+GEPA | NousResearch *hermes-agent-self-evolution* (ICLR 2026 Oral) |
