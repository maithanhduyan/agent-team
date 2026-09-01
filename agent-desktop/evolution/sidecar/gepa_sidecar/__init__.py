"""GEPA evolution sidecar — Python core (T12, TASK-9053 / Redmine #47).

Implements the hermes-agent-self-evolution pattern (DSPy + GEPA) as a
**compute worker** per ADR-009: a separate process spawned per run by
the Node/TS runner, communicating over JSON-RPC 2.0 on stdio
(`docs/gepa-pipeline.md` §4, T09).

Security envelope (SEC-GEPA-01..11 / ADR-009):
- runs with no network egress except an optional Node-controlled LM
  proxy (the sidecar never holds an API key — `ProxyLM`);
- scratch-only filesystem (no writes outside the given scratch dir);
- env-less config (no keys, no host paths outside scratch);
- emits candidates as **text + metadata only**; Node re-validates
  (size/semantic/test) — self-reports are never trusted.

The GEPA loop is implemented as three DSPy-style modules
(`modules.py`): EvaluateModule, ReflectModule, EvolveModule. DSPy
itself is an **optional** dependency (pinned in requirements.txt,
SEC-GEPA-10): when it is importable and a real LM backend is
configured the modules use it; otherwise the deterministic
`MockLM`/`ProxyLM` backends run the same loop offline (tests, CI,
no-key mode).
"""

__version__ = "0.1.0"
__all__ = ["__version__"]
