"""Env-less sidecar configuration (T09 §4.3, ADR-009 §6.1).

The `config` block in the `initialize` RPC is **env-less**: it carries
no API keys, no git credentials, no host paths outside the sandbox
scratch dir. Only `EVOLUTION_*`-shaped numeric/string knobs travel over
the wire; the Node runner (trust anchor) resolves everything else and
validates the block before sending it.

All knobs have safe defaults; invalid values fall back to defaults and
are reported in `validation_warnings` so the runner can record them in
the audit trail (SEC-GEPA-11).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

# SEC-GEPA-03 fixed ceiling: candidate SKILL.md <= 15 KB (15 360 bytes).
MAX_SKILL_BYTES_DEFAULT = 15360
# SEC-GEPA-02: the intra-run selection target defaults to 1.0; the PR
# gate ALWAYS requires the full-suite 100% pass regardless of this knob.
FITNESS_TARGET_DEFAULT = 1.0


@dataclass
class SidecarConfig:
    population_size: int = 8
    generations: int = 3
    elitism: int = 2
    fitness_target: float = FITNESS_TARGET_DEFAULT
    eval_sample: float = 1.0
    max_skill_bytes: int = MAX_SKILL_BYTES_DEFAULT
    random_seed: int = 42
    # Judge block is echoed for completeness only — verdicts are NEVER
    # produced by the sidecar (T09 §4.5, ADR-009 §6.3.3).
    judge: Dict[str, Any] = field(default_factory=lambda: {"enabled": True})
    # Optional Node-controlled LM proxy (ADR-009 §6.3.2). When absent,
    # the deterministic MockLM is used (offline / no-key mode).
    lm_proxy_url: str | None = None
    lm_proxy_token: str | None = None
    validation_warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Config surface recorded in the audit trail. The proxy token
        is NEVER serialized, not even as null (SEC-KEY-01/02)."""
        out = {
            "population_size": self.population_size,
            "generations": self.generations,
            "elitism": self.elitism,
            "fitness_target": self.fitness_target,
            "eval_sample": self.eval_sample,
            "max_skill_bytes": self.max_skill_bytes,
            "random_seed": self.random_seed,
            "judge": self.judge,
        }
        if self.lm_proxy_url:
            out["lm_proxy_url"] = self.lm_proxy_url
        return out


def _as_int(value: Any, default: int, lo: int, hi: int | None, name: str) -> int:
    if value is None:
        return default
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    if n < lo or (hi is not None and n > hi):
        return default
    return n


def _as_float(value: Any, default: float, lo: float, hi: float, name: str) -> float:
    if value is None:
        return default
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    if n < lo or n > hi:
        return default
    return n


def parse_sidecar_config(raw: Any) -> SidecarConfig:
    """Parse + validate the env-less config block. Invalid values fall
    back to defaults; each fallback is recorded as a warning."""
    warnings: List[str] = []
    if not isinstance(raw, dict):
        return SidecarConfig(validation_warnings=["config block is not an object; using defaults"])

    def guard_int(name: str, default: int, lo: int, hi: int | None = None) -> int:
        raw_value = raw.get(name)
        value = _as_int(raw_value, default, lo, hi, name)
        if raw_value is not None and value != raw_value:
            warnings.append(f"{name}: invalid value {raw_value!r}; using default {value}")
        return value

    def guard_float(name: str, default: float, lo: float, hi: float) -> float:
        raw_value = raw.get(name)
        value = _as_float(raw_value, default, lo, hi, name)
        if raw_value is not None and value != raw_value:
            warnings.append(f"{name}: invalid value {raw_value!r}; using default {value}")
        return value

    population = guard_int("population_size", 8, 1)
    generations = guard_int("generations", 3, 1)
    elitism = guard_int("elitism", 2, 1)
    if elitism > population:
        warnings.append(f"elitism {elitism} > population_size {population}; clamping to population")
        elitism = population
    fitness_target = guard_float("fitness_target", FITNESS_TARGET_DEFAULT, 0.0, 1.0)
    eval_sample = guard_float("eval_sample", 1.0, 0.01, 1.0)
    max_skill_bytes = guard_int("max_skill_bytes", MAX_SKILL_BYTES_DEFAULT, 1, MAX_SKILL_BYTES_DEFAULT)
    random_seed = guard_int("random_seed", 42, 0)
    judge = raw.get("judge") if isinstance(raw.get("judge"), dict) else {"enabled": True}
    lm_proxy_url = raw.get("lm_proxy_url") if isinstance(raw.get("lm_proxy_url"), str) else None
    # The proxy token is short-lived and read-only; it never leaves the
    # process and is never recorded (SEC-KEY-01/02).
    lm_proxy_token = raw.get("lm_proxy_token") if isinstance(raw.get("lm_proxy_token"), str) else None

    return SidecarConfig(
        population_size=population,
        generations=generations,
        elitism=elitism,
        fitness_target=fitness_target,
        eval_sample=eval_sample,
        max_skill_bytes=max_skill_bytes,
        random_seed=random_seed,
        judge=judge,
        lm_proxy_url=lm_proxy_url,
        lm_proxy_token=lm_proxy_token,
        validation_warnings=warnings,
    )
