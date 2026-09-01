"""GEPA evolution loop tests (T12, T09 §3.2) — deterministic MockLM."""

import unittest

from gepa_sidecar.config import parse_sidecar_config
from gepa_sidecar.evolution import Candidate, GepaEvolution

BASE_SKILL = """# Skill: install-dsh

Install and manage the DSH agent on Windows.

## Install
1. Resolve the target path.
2. Copy the payload.
3. Write config.

## Cleanup
- Remove installed artifacts.
"""

DATASET = [
    {
        "scenario": "efs",
        "context": "Install target dir is EFS-encrypted",
        "error": "installer proceeded silently into an encrypted dir",
        "fix": "Detect the EFS-encrypted target directory with cipher before install and refuse with a clear EFS message.",
    },
    {
        "scenario": "junction",
        "context": "Path component is an NTFS junction",
        "error": "naive traversal recursed forever on a junction cycle",
        "fix": "Resolve NTFS junction links to the real target before file operations and bound traversal with a visited set.",
    },
    {
        "scenario": "service-password",
        "context": "Service account password changed",
        "error": "credential updated but service never restarted",
        "fix": "Update the stored credential, restart the service, and preserve the previous credential on failure.",
    },
]


class EvolutionTest(unittest.TestCase):
    def _run(self, cfg_dict, emit=None):
        cfg = parse_sidecar_config(cfg_dict)
        evo = GepaEvolution(
            job_id="evo_t_01",
            base_skill_text=BASE_SKILL,
            dataset=DATASET,
            config=cfg,
            emit=emit,
            sidecar_version="0.1.0",
        )
        return evo.run(), evo

    def test_run_emits_every_candidate_and_reports(self):
        emitted = []
        result, _ = self._run({"population_size": 4, "generations": 2, "elitism": 1, "random_seed": 3}, emit=emitted.append)
        self.assertEqual(result.status, "ok")
        self.assertGreaterEqual(result.generations_run, 1)
        self.assertIsNotNone(result.best_candidate_id)
        # seed + (population_size - elitism) per generation
        expected = 1 + (4 - 1) * result.generations_run
        self.assertGreaterEqual(len(emitted), expected)
        for cand in emitted:
            self.assertIsInstance(cand, Candidate)
            self.assertGreater(cand.size_bytes, 0)
            self.assertIn(cand.candidate_id, {c.candidate_id for c in emitted})

    def test_candidate_ids_follow_gen_pattern(self):
        emitted = []
        self._run({"population_size": 3, "generations": 1, "elitism": 1, "random_seed": 1}, emit=emitted.append)
        ids = {c.candidate_id for c in emitted}
        self.assertIn("gen0-00", ids)
        self.assertTrue(any(i.startswith("gen1-") for i in ids))

    def test_candidate_size_bytes_match_text(self):
        emitted = []
        self._run({"population_size": 3, "generations": 1, "elitism": 1, "random_seed": 1}, emit=emitted.append)
        for cand in emitted:
            self.assertEqual(cand.size_bytes, len(cand.skill_text.encode("utf-8")))

    def test_candidates_bounded_by_max_skill_bytes(self):
        emitted = []
        self._run(
            {"population_size": 3, "generations": 2, "elitism": 1, "max_skill_bytes": 4096, "random_seed": 5},
            emit=emitted.append,
        )
        for cand in emitted:
            self.assertLessEqual(cand.size_bytes, 4096, cand.candidate_id)

    def test_cancel_stops_early(self):
        emitted = []
        cfg = parse_sidecar_config({"population_size": 3, "generations": 10, "elitism": 1})
        calls = {"n": 0}

        def cancel_flag():
            calls["n"] += 1
            return calls["n"] > 1  # cancel at the second generation check

        # Dataset whose scenarios the base skill does NOT cover, so the
        # loop cannot early-stop on fitness 1.0 and cancel is reached.
        uncovered = [
            {
                "scenario": "exotic",
                "context": "unknown platform quirk",
                "error": "unhandled",
                "fix": "Handle the exotic quirk with a dedicated workaround step.",
            }
            for _ in range(4)
        ]
        evo = GepaEvolution(
            job_id="evo_t_02",
            base_skill_text=BASE_SKILL,
            dataset=uncovered,
            config=cfg,
            emit=emitted.append,
            should_cancel=cancel_flag,
        )
        result = evo.run()
        self.assertEqual(result.status, "cancelled")
        self.assertLess(result.generations_run, 10)

    def test_result_candidates_are_dicts(self):
        result, _ = self._run({"population_size": 3, "generations": 1, "elitism": 1, "random_seed": 2})
        self.assertTrue(all(isinstance(c, dict) for c in result.candidates))
        self.assertTrue(all("skill_text" in c for c in result.candidates))

    def test_deterministic_given_seed(self):
        def collect(seed):
            emitted = []
            self._run({"population_size": 4, "generations": 2, "elitism": 1, "random_seed": seed}, emit=emitted.append)
            return [c.skill_text for c in emitted]

        a = collect(42)
        b = collect(42)
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
