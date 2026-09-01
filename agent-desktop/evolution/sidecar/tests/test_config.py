"""Sidecar config tests (T12)."""

import unittest

from gepa_sidecar.config import MAX_SKILL_BYTES_DEFAULT, parse_sidecar_config


class ConfigTest(unittest.TestCase):
    def test_defaults(self):
        cfg = parse_sidecar_config(None)
        self.assertEqual(cfg.population_size, 8)
        self.assertEqual(cfg.generations, 3)
        self.assertEqual(cfg.elitism, 2)
        self.assertEqual(cfg.fitness_target, 1.0)
        self.assertEqual(cfg.eval_sample, 1.0)
        self.assertEqual(cfg.max_skill_bytes, MAX_SKILL_BYTES_DEFAULT)
        self.assertEqual(cfg.random_seed, 42)
        self.assertEqual(cfg.lm_proxy_url, None)
        self.assertIn("config block is not an object", cfg.validation_warnings[0])

    def test_valid_values_accepted(self):
        cfg = parse_sidecar_config(
            {
                "population_size": 4,
                "generations": 2,
                "elitism": 1,
                "fitness_target": 0.9,
                "eval_sample": 0.5,
                "max_skill_bytes": 10240,
                "random_seed": 7,
            }
        )
        self.assertEqual(cfg.population_size, 4)
        self.assertEqual(cfg.generations, 2)
        self.assertEqual(cfg.elitism, 1)
        self.assertEqual(cfg.fitness_target, 0.9)
        self.assertEqual(cfg.eval_sample, 0.5)
        self.assertEqual(cfg.max_skill_bytes, 10240)
        self.assertEqual(cfg.random_seed, 7)
        self.assertEqual(cfg.validation_warnings, [])

    def test_invalid_values_fall_back_with_warning(self):
        cfg = parse_sidecar_config(
            {
                "population_size": 0,          # below min
                "generations": "three",         # non-numeric
                "elitism": -1,
                "fitness_target": 2.0,          # above max
                "eval_sample": 0.0,
                "max_skill_bytes": 999999,      # above the SEC-GEPA-03 ceiling
                "random_seed": -5,
            }
        )
        self.assertEqual(cfg.population_size, 8)
        self.assertEqual(cfg.generations, 3)
        self.assertEqual(cfg.elitism, 2)
        self.assertEqual(cfg.fitness_target, 1.0)
        self.assertEqual(cfg.eval_sample, 1.0)
        self.assertEqual(cfg.max_skill_bytes, MAX_SKILL_BYTES_DEFAULT)
        self.assertEqual(cfg.random_seed, 42)
        self.assertGreaterEqual(len(cfg.validation_warnings), 5)

    def test_elitism_clamped_to_population(self):
        cfg = parse_sidecar_config({"population_size": 3, "elitism": 9})
        self.assertEqual(cfg.elitism, 3)
        self.assertTrue(any("clamping" in w for w in cfg.validation_warnings))

    def test_max_skill_bytes_never_above_ceiling(self):
        cfg = parse_sidecar_config({"max_skill_bytes": 50000})
        self.assertEqual(cfg.max_skill_bytes, MAX_SKILL_BYTES_DEFAULT)

    def test_lm_proxy_url_and_token(self):
        cfg = parse_sidecar_config({"lm_proxy_url": "http://127.0.0.1:9999", "lm_proxy_token": "abc"})
        self.assertEqual(cfg.lm_proxy_url, "http://127.0.0.1:9999")
        self.assertEqual(cfg.lm_proxy_token, "abc")
        # The token key must never appear in the audit-surface dict (SEC-KEY-02).
        self.assertNotIn("lm_proxy_token", cfg.to_dict())

    def test_to_dict_never_contains_token_value(self):
        cfg = parse_sidecar_config({"lm_proxy_token": "super-secret"})
        self.assertNotIn("super-secret", repr(cfg.to_dict()))


if __name__ == "__main__":
    unittest.main()
