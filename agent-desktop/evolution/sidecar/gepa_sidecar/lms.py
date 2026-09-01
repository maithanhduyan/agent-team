"""LM backends for the GEPA loop (T09 §3.2, ADR-009 §6.3.2).

The sidecar is a compute worker and **never holds an API key**. Two
backends:

- `MockLM` (default, offline): deterministic, zero network. Produces
  dataset-driven mutations and heuristic evaluations so the whole
  pipeline runs in tests / CI / no-key mode (SEC-KEY-03 — a missing
  key never blocks the pipeline; the mock is the no-key default).
- `ProxyLM`: calls a **Node-controlled HTTP forwarder** (short-lived,
  read-only handle; the key stays with Node — ADR-009 §6.3.2). If the
  proxy is unreachable the caller falls back to MockLM and records the
  fact in the run report (skip, never fail).

Every backend exposes `complete(prompt) -> str`.
"""

from __future__ import annotations

import json
import random
import re
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from .config import SidecarConfig

# ---------------------------------------------------------------------------
# Dataset record shape consumed by the mock backends (T10 §4.2 subset).
# ---------------------------------------------------------------------------

DatasetRecord = Dict[str, Any]


def _scenario_of(record: DatasetRecord) -> str:
    return str(record.get("scenario", ""))


def _fix_of(record: DatasetRecord) -> str:
    return str(record.get("fix", ""))


# ---------------------------------------------------------------------------
# MockLM — deterministic offline backend
# ---------------------------------------------------------------------------


class MockLM:
    """Deterministic, network-free LM used by default (no-key mode).

    Three capabilities, all seeded by `config.random_seed` so a run is
    reproducible (CG-1):

    - `evaluate(skill_text, dataset)`: heuristic fitness = fraction of
      dataset cases whose scenario is "handled" by the candidate text
      (keyword coverage of the fix for that scenario, sampled by
      `eval_sample`).
    - `reflect(skill_text, dataset, fitness)`: picks the worst-handled
      scenario and emits a `{context, error, fix}` reflection shaped
      like the T05 reflection (spec §8.3).
    - `evolve(base_text, candidate_text, reflection, history)`: appends
      a fix-derived guidance block for the reflected scenario.

    These are **selection-only** heuristics: the Node side re-runs the
    real guardrails (size/semantic/test) and the fitness gate, and never
    trusts this self-report (ADR-009 §6.3.3).
    """

    def __init__(self, config: SidecarConfig):
        self._rng = random.Random(config.random_seed)
        self._max_skill_bytes = config.max_skill_bytes
        self._eval_sample = config.eval_sample

    # -- LM surface ---------------------------------------------------
    def complete(self, prompt: str) -> str:
        """Generic completion: parse a JSON `{op, ...}` request and
        dispatch to the deterministic capability."""
        try:
            req = json.loads(prompt)
        except json.JSONDecodeError:
            return json.dumps({"error": "mock LM: prompt is not JSON"})
        op = req.get("op")
        if op == "evaluate":
            return self.evaluate(req.get("skill_text", ""), req.get("dataset", []))
        if op == "reflect":
            return self.reflect(req.get("skill_text", ""), req.get("dataset", []), req.get("fitness"))
        if op == "evolve":
            return self.evolve(
                req.get("base_text", ""),
                req.get("candidate_text", ""),
                req.get("reflection"),
                req.get("history", []),
            )
        return json.dumps({"error": f"mock LM: unknown op {op!r}"})

    # -- capabilities -------------------------------------------------
    def evaluate(self, skill_text: str, dataset: List[DatasetRecord]) -> str:
        sampled = self._sample(dataset)
        if not sampled:
            return json.dumps({"fitness": 0.0, "handled": 0, "total": 0, "details": []})
        details: List[Dict[str, Any]] = []
        handled = 0
        for rec in sampled:
            scenario = _scenario_of(rec)
            keywords = self._keywords(_fix_of(rec))
            hit = sum(1 for kw in keywords if kw.lower() in skill_text.lower())
            ok = hit > 0
            handled += 1 if ok else 0
            details.append({"scenario": scenario, "ok": ok, "keywords_hit": hit})
        fitness = handled / len(sampled)
        return json.dumps({"fitness": fitness, "handled": handled, "total": len(sampled), "details": details})

    def reflect(self, skill_text: str, dataset: List[DatasetRecord], fitness: Optional[float]) -> str:
        sampled = self._sample(dataset)
        worst = None
        worst_hits = None
        for rec in sampled:
            scenario = _scenario_of(rec)
            keywords = self._keywords(_fix_of(rec))
            hits = sum(1 for kw in keywords if kw.lower() in skill_text.lower())
            if worst is None or hits < worst_hits:
                worst, worst_hits = rec, hits
        if worst is None:
            return json.dumps({"context": "", "error": "", "fix": ""})
        return json.dumps(
            {
                "context": str(worst.get("context", "")),
                "error": str(worst.get("error", "")),
                "fix": str(worst.get("fix", "")),
            }
        )

    def evolve(
        self,
        base_text: str,
        candidate_text: str,
        reflection: Optional[Dict[str, Any]],
        history: List[Dict[str, Any]],
    ) -> str:
        base = candidate_text or base_text
        if not reflection:
            return base
        fix = str(reflection.get("fix", "")).strip()
        error = str(reflection.get("error", "")).strip()
        scenario = str(reflection.get("scenario", "unknown"))
        if not fix:
            return base
        block = (
            "\n\n## Lesson learned (GEPA evolution, mock LM)\n\n"
            f"Scenario: {scenario}\n"
            f"Failure: {error}\n"
            f"Correct handling: {fix}\n"
        )
        # Bounded: never exceed the SEC-GEPA-03 ceiling; if the block
        # would overflow, trim it to fit.
        candidate = base + block
        if len(candidate.encode("utf-8")) > self._max_skill_bytes:
            allowed = self._max_skill_bytes - len(base.encode("utf-8"))
            if allowed > 64:
                candidate = base + "\n\n" + block.strip()[:allowed]
            else:
                candidate = base
        return candidate

    # -- helpers ------------------------------------------------------
    def _sample(self, dataset: List[DatasetRecord]) -> List[DatasetRecord]:
        if self._eval_sample >= 1.0 or len(dataset) <= 1:
            return list(dataset)
        n = max(1, int(round(len(dataset) * self._eval_sample)))
        idx = list(range(len(dataset)))
        self._rng.shuffle(idx)
        return [dataset[i] for i in idx[:n]]

    @staticmethod
    def _keywords(fix_text: str) -> List[str]:
        # Deterministic keyword extraction: the longest significant
        # words in the fix (>= 5 chars, deduped, order-stable).
        words = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{4,}", fix_text)
        seen: List[str] = []
        for w in words:
            if w.lower() not in {s.lower() for s in seen}:
                seen.append(w)
        return seen[:12]


# ---------------------------------------------------------------------------
# ProxyLM — Node-controlled HTTP forwarder (ADR-009 §6.3.2)
# ---------------------------------------------------------------------------


class ProxyLM:
    """Calls a Node-controlled HTTP forwarder with a short-lived token.

    The token and URL come from the `initialize` params (env-less
    config); the sidecar never sees or stores the real API key
    (SEC-KEY-01/02). When the proxy is unreachable, `complete` raises;
    the evolution loop catches it, falls back to MockLM and records the
    event in the run report (skip, never fail — SEC-KEY-03).
    """

    def __init__(self, url: str, token: str, timeout_s: float = 30.0):
        self._url = url
        self._token = token
        self._timeout = timeout_s

    def complete(self, prompt: str) -> str:
        body = json.dumps({"prompt": prompt}).encode("utf-8")
        req = urllib.request.Request(
            self._url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._token}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:  # noqa: S310 — Node-controlled URL
                return resp.read().decode("utf-8")
        except urllib.error.URLError as exc:
            raise RuntimeError(f"LM proxy unreachable: {exc}") from exc


def make_lm(config: SidecarConfig):
    """Build the LM backend: ProxyLM when configured, else MockLM."""
    if config.lm_proxy_url and config.lm_proxy_token:
        return ProxyLM(config.lm_proxy_url, config.lm_proxy_token)
    return MockLM(config)
