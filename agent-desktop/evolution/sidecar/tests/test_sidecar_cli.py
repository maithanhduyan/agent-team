"""Sidecar CLI end-to-end tests — spawn `python -m gepa_sidecar` and
drive the full JSON-RPC lifecycle over stdio (T12, T09 §4.2/§4.3)."""

import hashlib
import json
import os
import subprocess
import sys
import unittest

BASE_SKILL = """# Skill: install-dsh

Install and manage the DSH agent on Windows.

## Install
1. Resolve the target path.
2. Copy the payload.
3. Write config.
"""

DATASET = {
    "schema_version": 1,
    "cases": [
        {
            "scenario": "efs",
            "context": "EFS-encrypted target",
            "error": "silently proceeded",
            "fix": "Detect the EFS-encrypted target directory with cipher and refuse with a clear EFS message.",
        },
        {
            "scenario": "junction",
            "context": "NTFS junction path",
            "error": "recursion loop",
            "fix": "Resolve NTFS junction links to the real target and bound traversal with a visited set.",
        },
    ],
}

SIDECAR_DIR = os.path.join(os.path.dirname(__file__), "..")


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_json(value) -> str:
    return hashlib.sha256(json.dumps(value).encode("utf-8")).hexdigest()


class SidecarCliTest(unittest.TestCase):
    def _spawn(self, job_id="evo_cli_01"):
        return subprocess.Popen(
            [sys.executable, "-m", "gepa_sidecar", "--job", job_id],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=SIDECAR_DIR,
        )

    def _write(self, proc, msg):
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()

    def _read_results(self, proc):
        out_lines = proc.stdout.readlines()
        return [json.loads(l) for l in out_lines if l.strip()]

    def test_full_lifecycle_initialize_evolve(self):
        proc = self._spawn()
        try:
            self._write(
                proc,
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "job_id": "evo_cli_01",
                        "dataset_raw": json.dumps(DATASET),
                        "dataset_sha256": sha256_json(DATASET),
                        "base_skill_text": BASE_SKILL,
                        "base_skill_sha256": sha256(BASE_SKILL),
                        "config": {"population_size": 3, "generations": 1, "elitism": 1, "random_seed": 9},
                        "sidecar_version": "0.1.0",
                    },
                },
            )
            self._write(proc, {"jsonrpc": "2.0", "id": 2, "method": "evolve", "params": {}})
            proc.stdin.close()
            msgs = self._read_results(proc)

            init_resp = [m for m in msgs if m.get("id") == 1][0]
            self.assertEqual(init_resp["result"]["ready"], True)
            self.assertEqual(init_resp["result"]["sidecar_version"], "0.1.0")

            candidates = [m for m in msgs if m.get("method") == "candidate"]
            self.assertGreaterEqual(len(candidates), 1)
            for c in candidates:
                params = c["params"]
                self.assertIn("candidate_id", params)
                self.assertIn("skill_text", params)
                self.assertGreater(params["size_bytes"], 0)

            evolve_resp = [m for m in msgs if m.get("id") == 2][0]
            result = evolve_resp["result"]
            self.assertEqual(result["status"], "ok")
            self.assertGreaterEqual(result["generations_run"], 1)
            self.assertIsNotNone(result["best_candidate_id"])
            self.assertEqual(result["candidate_count"], len(candidates))
        finally:
            proc.kill()

    def test_initialize_rejects_dataset_sha256_mismatch(self):
        proc = self._spawn("evo_cli_02")
        try:
            self._write(
                proc,
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "job_id": "evo_cli_02",
                        "dataset_raw": json.dumps(DATASET),
                        "dataset_sha256": "0" * 64,  # wrong hash
                        "base_skill_text": BASE_SKILL,
                        "config": {},
                        "sidecar_version": "0.1.0",
                    },
                },
            )
            proc.stdin.close()
            msgs = self._read_results(proc)
            err = [m for m in msgs if "error" in m][0]
            self.assertIn("sha256 mismatch", err["error"]["message"])
        finally:
            proc.kill()

    def test_initialize_rejects_job_id_mismatch(self):
        proc = self._spawn("evo_cli_03")
        try:
            self._write(
                proc,
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "job_id": "someone-else",
                        "dataset": DATASET,
                        "base_skill_text": BASE_SKILL,
                        "config": {},
                        "sidecar_version": "0.1.0",
                    },
                },
            )
            proc.stdin.close()
            msgs = self._read_results(proc)
            err = [m for m in msgs if "error" in m][0]
            self.assertIn("job_id mismatch", err["error"]["message"])
        finally:
            proc.kill()

    def test_evolve_before_initialize_is_rejected(self):
        proc = self._spawn("evo_cli_04")
        try:
            self._write(proc, {"jsonrpc": "2.0", "id": 2, "method": "evolve", "params": {}})
            proc.stdin.close()
            msgs = self._read_results(proc)
            err = [m for m in msgs if "error" in m][0]
            self.assertIn("before initialize", err["error"]["message"])
        finally:
            proc.kill()

    def test_cancel_after_initialize_ok(self):
        proc = self._spawn("evo_cli_05")
        try:
            self._write(
                proc,
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "job_id": "evo_cli_05",
                        "dataset_raw": json.dumps(DATASET),
                        "base_skill_text": BASE_SKILL,
                        "config": {"population_size": 3, "generations": 1},
                        "sidecar_version": "0.1.0",
                    },
                },
            )
            self._write(proc, {"jsonrpc": "2.0", "id": 3, "method": "cancel", "params": {}})
            proc.stdin.close()
            msgs = self._read_results(proc)
            cancel_resp = [m for m in msgs if m.get("id") == 3][0]
            self.assertEqual(cancel_resp["result"]["ok"], True)
        finally:
            proc.kill()

    def test_sidecar_version_mismatch_rejected(self):
        proc = self._spawn("evo_cli_06")
        try:
            self._write(
                proc,
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "job_id": "evo_cli_06",
                        "dataset_raw": json.dumps(DATASET),
                        "base_skill_text": BASE_SKILL,
                        "config": {},
                        "sidecar_version": "99.0.0",
                    },
                },
            )
            proc.stdin.close()
            msgs = self._read_results(proc)
            err = [m for m in msgs if "error" in m][0]
            self.assertIn("version mismatch", err["error"]["message"])
        finally:
            proc.kill()


if __name__ == "__main__":
    unittest.main()
