"""Candidate model + evolution loop (GEPA, T09 §3.2).

The loop maintains a population of candidates; per generation it runs
evaluate → reflect → evolve → evaluate and keeps the top `elitism`
candidates, replacing the rest. It stops after `generations` or when
the best candidate reaches `fitness_target` (early stop). Every
candidate is emitted with its self-evaluated metadata; Node re-runs
all guardrails and never trusts the self-report (ADR-009 §6.3.3).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .config import SidecarConfig
from .lms import MockLM, make_lm
from .modules import EvaluateModule, EvolveModule, ReflectModule


@dataclass
class Candidate:
    candidate_id: str
    generation: int
    skill_text: str
    size_bytes: int
    self_fitness: Optional[float]
    self_guardrails: Dict[str, Any]
    reflection: Optional[Dict[str, Any]]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "generation": self.generation,
            "skill_text": self.skill_text,
            "size_bytes": self.size_bytes,
            "self_fitness": self.self_fitness,
            "self_guardrails": self.self_guardrails,
            "reflection": self.reflection,
        }


@dataclass
class EvolutionResult:
    job_id: str
    status: str
    generations_run: int
    best_candidate_id: Optional[str]
    started_at: str
    ended_at: str
    sidecar_version: str
    candidates: List[Dict[str, Any]] = field(default_factory=list)
    lm_fallback_note: Optional[str] = None
    error: Optional[str] = None


class GepaEvolution:
    """One GEPA evolution run (population → evaluate → reflect →
    evolve → select). Emits EVERY candidate through `emit`."""

    def __init__(
        self,
        job_id: str,
        base_skill_text: str,
        dataset: List[Dict[str, Any]],
        config: SidecarConfig,
        emit: Optional[Callable[[Candidate], None]] = None,
        should_cancel: Optional[Callable[[], bool]] = None,
        sidecar_version: str = "0.1.0",
    ):
        self._job_id = job_id
        self._base = base_skill_text
        self._dataset = dataset
        self._cfg = config
        self._emit = emit
        self._should_cancel = should_cancel or (lambda: False)
        self._sidecar_version = sidecar_version
        self._lm_fallback_note: Optional[str] = None
        self._emitted: Dict[str, Candidate] = {}
        self._population: List[Candidate] = []
        self._setup_lm()

    def _setup_lm(self) -> None:
        self._lm = make_lm(self._cfg)
        self._evaluate = EvaluateModule(self._lm)
        self._reflect = ReflectModule(self._lm)
        self._evolve = EvolveModule(self._lm)

    # -- public API ---------------------------------------------------
    def run(self) -> EvolutionResult:
        started = _now()
        history: List[Dict[str, Any]] = []
        best_id: Optional[str] = None
        generations_run = 0

        # Seed the population with the base skill (generation 0).
        seed = self._make_candidate("gen0-00", 0, self._base, None, evaluate=False)
        self._population = [seed]
        self._emit_candidate(seed)
        history.append({"candidate_id": seed.candidate_id, "fitness": seed.self_fitness})

        try:
            for gen in range(1, self._cfg.generations + 1):
                if self._should_cancel():
                    return self._finish(started, "cancelled", best_id, generations_run, history)
                if isinstance(self._lm, MockLM):
                    self._lm._rng.seed(self._cfg.random_seed + gen)  # deterministic per generation

                scored = self._score_population()
                best = scored[0]
                best_id = best["candidate"].candidate_id
                best_candidate = best["candidate"]

                reflection = self._reflect.forward(best_candidate.skill_text, self._dataset, best["fitness"])

                # Keep the elites; evolve the rest (every new candidate
                # is emitted).
                new_population: List[Candidate] = []
                for entry in scored[: self._cfg.elitism]:
                    new_population.append(entry["candidate"])
                    history.append(
                        {"candidate_id": entry["candidate"].candidate_id, "fitness": entry["fitness"]}
                    )
                for rank in range(self._cfg.elitism, self._cfg.population_size):
                    base_text = new_population[0].skill_text if new_population else self._base
                    candidate_text = best_candidate.skill_text if rank % 2 == 0 else base_text
                    new_text = self._evolve.forward(
                        self._base, candidate_text, reflection, history[-5:]
                    )
                    new_candidate = self._make_candidate(
                        f"gen{gen}-{rank:02d}", gen, new_text, reflection
                    )
                    new_population.append(new_candidate)
                    history.append(
                        {"candidate_id": new_candidate.candidate_id, "fitness": new_candidate.self_fitness}
                    )
                    self._emit_candidate(new_candidate)

                self._population = new_population
                generations_run = gen

                # Early stop on the fitness target (intra-run selection
                # only; the PR gate always requires the full suite).
                if best["fitness"] >= self._cfg.fitness_target and self._cfg.fitness_target >= 1.0:
                    break
        except RuntimeError as exc:
            # LM proxy unreachable → deterministic fallback (skip, never
            # fail — SEC-KEY-03). Recorded in the run report.
            self._lm_fallback_note = str(exc)
            self._setup_lm()
            return self._run_mock(started, history, best_id, generations_run)

        return self._finish(started, "ok", best_id, generations_run, history)

    def _run_mock(
        self,
        started: str,
        history: List[Dict[str, Any]],
        best_id: Optional[str],
        generations_run: int,
    ) -> EvolutionResult:
        """Re-run the loop with the deterministic MockLM after a proxy
        failure (never blocks the pipeline — SEC-KEY-03)."""
        self._population = [self._make_candidate("gen0-00", 0, self._base, None, evaluate=False)]
        for gen in range(1, self._cfg.generations + 1):
            if self._should_cancel():
                return self._finish(started, "cancelled", best_id, gen, history)
            self._lm._rng.seed(self._cfg.random_seed + gen)
            scored = self._score_population()
            best_candidate = scored[0]["candidate"]
            best_id = best_candidate.candidate_id
            reflection = self._reflect.forward(best_candidate.skill_text, self._dataset, scored[0]["fitness"])
            new_population = [s["candidate"] for s in scored[: self._cfg.elitism]]
            for rank in range(self._cfg.elitism, self._cfg.population_size):
                base_text = new_population[0].skill_text if new_population else self._base
                candidate_text = best_candidate.skill_text if rank % 2 == 0 else base_text
                new_text = self._evolve.forward(self._base, candidate_text, reflection, history[-5:])
                new_candidate = self._make_candidate(f"gen{gen}-{rank:02d}", gen, new_text, reflection)
                new_population.append(new_candidate)
                history.append(
                    {"candidate_id": new_candidate.candidate_id, "fitness": new_candidate.self_fitness}
                )
                self._emit_candidate(new_candidate)
            self._population = new_population
        return self._finish(started, "ok", best_id, self._cfg.generations, history)

    # -- internals ----------------------------------------------------
    def _score_population(self) -> List[Dict[str, Any]]:
        scored: List[Dict[str, Any]] = []
        for cand in self._population:
            eval_out = self._evaluate.forward(cand.skill_text, self._dataset)
            scored.append({"candidate": cand, "fitness": float(eval_out.get("fitness", 0.0))})
        scored.sort(key=lambda s: s["fitness"], reverse=True)
        return scored

    def _make_candidate(
        self,
        candidate_id: str,
        generation: int,
        skill_text: str,
        reflection: Optional[Dict[str, Any]],
        evaluate: bool = True,
    ) -> Candidate:
        size = len(skill_text.encode("utf-8"))
        fitness: Optional[float] = None
        if evaluate and generation > 0:
            try:
                eval_out = self._evaluate.forward(skill_text, self._dataset)
                fitness = float(eval_out.get("fitness"))
            except Exception:  # noqa: BLE001 — fitness is informational
                fitness = None
        guardrails = {
            "size_bytes": size,
            "size_pass": size <= self._cfg.max_skill_bytes,
            "self_reported": True,  # informational only — Node re-validates
        }
        return Candidate(
            candidate_id=candidate_id,
            generation=generation,
            skill_text=skill_text,
            size_bytes=size,
            self_fitness=fitness,
            self_guardrails=guardrails,
            reflection=reflection,
        )

    def _emit_candidate(self, candidate: Candidate) -> None:
        if candidate.candidate_id in self._emitted:
            return
        self._emitted[candidate.candidate_id] = candidate
        if self._emit:
            self._emit(candidate)

    def _finish(
        self,
        started: str,
        status: str,
        best_id: Optional[str],
        generations_run: int,
        history: List[Dict[str, Any]],
    ) -> EvolutionResult:
        return EvolutionResult(
            job_id=self._job_id,
            status=status,
            generations_run=generations_run,
            best_candidate_id=best_id,
            started_at=started,
            ended_at=_now(),
            sidecar_version=self._sidecar_version,
            candidates=[c.to_dict() for c in self._emitted.values()],
            lm_fallback_note=self._lm_fallback_note,
        )


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
