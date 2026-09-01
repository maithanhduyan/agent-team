"""DSPy-style GEPA modules (hermes pattern, T09 §3.2).

Three modules mirror hermes-agent-self-evolution:

- `EvaluateModule` — scores a candidate against the eval dataset
  (or the `eval_sample` subset); the **final** gate always uses the
  full suite on the Node side (SEC-GEPA-02).
- `ReflectModule` — given base skill + dataset + current candidate +
  fitness, produces an error analysis `{context, error, fix}` (the
  same shape the T05 reflection uses, spec §8.3).
- `EvolveModule` — generates the next candidate from
  (base, candidate, reflection, history).

Each module takes an LM backend; with `MockLM` the modules are fully
deterministic (offline runs); with `ProxyLM` the same code path drives
a real model through the Node-controlled forwarder.

Module outputs are **self-reports**: the Node side re-runs all
deterministic guardrails and never trusts them (ADR-009 §6.3.3).
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from .lms import MockLM, ProxyLM

LM = Any  # MockLM | ProxyLM — duck-typed `complete(prompt) -> str`


class EvaluateModule:
    """Score a candidate on the dataset: returns `{fitness, handled,
    total, details}`."""

    def __init__(self, lm: LM):
        self._lm = lm

    def forward(self, skill_text: str, dataset: List[Dict[str, Any]]) -> Dict[str, Any]:
        prompt = json.dumps({"op": "evaluate", "skill_text": skill_text, "dataset": dataset})
        return self._parse(self._lm.complete(prompt))

    def _parse(self, text: str) -> Dict[str, Any]:
        try:
            out = json.loads(text)
        except json.JSONDecodeError:
            return {"fitness": 0.0, "handled": 0, "total": 0, "details": [], "error": "malformed evaluate output"}
        if not isinstance(out, dict):
            return {"fitness": 0.0, "handled": 0, "total": 0, "details": [], "error": "evaluate output not object"}
        return out


class ReflectModule:
    """Error analysis of the current best candidate: returns
    `{context, error, fix}` (+ `scenario` when known)."""

    def __init__(self, lm: LM):
        self._lm = lm

    def forward(
        self,
        skill_text: str,
        dataset: List[Dict[str, Any]],
        fitness: Optional[float] = None,
    ) -> Dict[str, Any]:
        prompt = json.dumps(
            {"op": "reflect", "skill_text": skill_text, "dataset": dataset, "fitness": fitness}
        )
        text = self._lm.complete(prompt)
        try:
            out = json.loads(text)
        except json.JSONDecodeError:
            return {"context": "", "error": "", "fix": "", "error_note": "malformed reflect output"}
        return out if isinstance(out, dict) else {"context": "", "error": "", "fix": ""}


class EvolveModule:
    """Next candidate: applies the reflection to the current candidate
    (bounded by `max_skill_bytes` — SEC-GEPA-03)."""

    def __init__(self, lm: LM):
        self._lm = lm

    def forward(
        self,
        base_text: str,
        candidate_text: str,
        reflection: Optional[Dict[str, Any]],
        history: List[Dict[str, Any]],
    ) -> str:
        prompt = json.dumps(
            {
                "op": "evolve",
                "base_text": base_text,
                "candidate_text": candidate_text,
                "reflection": reflection,
                "history": history,
            }
        )
        return self._lm.complete(prompt)
