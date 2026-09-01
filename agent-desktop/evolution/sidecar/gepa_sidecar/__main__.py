"""GEPA sidecar console entry — `python -m gepa_sidecar --job <id>`.

JSON-RPC 2.0 over stdio (T09 §4.2/§4.3). Lifecycle per run:
`initialize` (handshake; validates dataset/base-skill sha256) →
`evolve` (streams `candidate` + `progress` notifications) →
`cancel` (cooperative stop) → EOF/exit. The sidecar never initiates
actions; Node enforces per-job resource limits and a hard wall-clock
timeout and kills a hung sidecar (fail closed — ADR-009 §6.3.4).

Usage:
    python3 -m gepa_sidecar --job evo_20260901_01 [--scratch <dir>]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from typing import Any, Dict, List, Optional

from . import __version__
from .config import parse_sidecar_config
from .evolution import Candidate, GepaEvolution
from .protocol import MethodRegistry, RpcError, SidecarProtocol, serve

INVALID_PARAMS = -32602


class SidecarServer:
    """Holds the initialize state and implements the RPC methods."""

    def __init__(self, job_id: str, scratch_dir: str, protocol: SidecarProtocol):
        self._job_id = job_id
        self._scratch = scratch_dir
        self._protocol = protocol
        self._initialized = False
        self._config = None
        self._base_skill: str = ""
        self._dataset: List[Dict[str, Any]] = []
        self._evolution: Optional[GepaEvolution] = None
        self._cancel_flag = False

    # -- RPC methods ---------------------------------------------------
    def initialize(self, params: Dict[str, Any]) -> Dict[str, Any]:
        # Data whitelist (ADR-009 §6.1): dataset JSON + base skill text
        # + env-less config + job id + scratch dir path. Never keys.
        job_id = params.get("job_id")
        if job_id != self._job_id:
            raise RpcError(INVALID_PARAMS, f"job_id mismatch: got {job_id!r}, expected {self._job_id!r}")

        dataset_raw = params.get("dataset_raw")
        if not isinstance(dataset_raw, str) or not dataset_raw.strip():
            raise RpcError(INVALID_PARAMS, "dataset_raw must be the dataset JSON text")
        expected_sha = params.get("dataset_sha256")
        actual_sha = hashlib.sha256(dataset_raw.encode("utf-8")).hexdigest()
        if expected_sha and actual_sha != expected_sha:
            raise RpcError(
                INVALID_PARAMS,
                f"dataset sha256 mismatch: expected {expected_sha}, got {actual_sha}",
            )
        try:
            dataset = json.loads(dataset_raw)
        except json.JSONDecodeError as exc:
            raise RpcError(INVALID_PARAMS, f"dataset_raw is not valid JSON: {exc}") from exc
        if not isinstance(dataset, dict) or not isinstance(dataset.get("cases"), list):
            raise RpcError(INVALID_PARAMS, "dataset must be a dataset object with a cases array")

        base_skill = params.get("base_skill_text")
        if not isinstance(base_skill, str) or not base_skill.strip():
            raise RpcError(INVALID_PARAMS, "base_skill_text must be a non-empty string")
        expected_base_sha = params.get("base_skill_sha256")
        if expected_base_sha:
            actual_base = hashlib.sha256(base_skill.encode("utf-8")).hexdigest()
            if actual_base != expected_base_sha:
                raise RpcError(
                    INVALID_PARAMS,
                    f"base skill sha256 mismatch: expected {expected_base_sha}, got {actual_base}",
                )

        config = parse_sidecar_config(params.get("config"))
        # The short-lived proxy token travels as a SEPARATE initialize
        # param (never inside the audit-recorded config block, never
        # persisted/logged — SEC-KEY-02, ADR-009 §6.3.2).
        if params.get("lm_proxy_token") is not None:
            config.lm_proxy_token = params["lm_proxy_token"]
        requested_version = params.get("sidecar_version")
        if requested_version and requested_version != __version__:
            raise RpcError(
                INVALID_PARAMS,
                f"sidecar version mismatch: runner wants {requested_version}, sidecar is {__version__}",
            )

        self._config = config
        self._base_skill = base_skill
        self._dataset = dataset["cases"]
        self._initialized = True
        self._cancel_flag = False

        return {
            "ready": True,
            "sidecar_version": __version__,
            "job_id": self._job_id,
            "config_warnings": config.validation_warnings,
        }

    def evolve(self, params: Dict[str, Any]) -> Dict[str, Any]:
        if not self._initialized or self._config is None:
            raise RpcError(INVALID_PARAMS, "evolve before initialize is not allowed")

        self._cancel_flag = False

        def emit(candidate: Candidate) -> None:
            self._protocol.send_notification("candidate", candidate.to_dict())

        def progress(gen: int, best: Optional[float]) -> None:
            self._protocol.send_notification(
                "progress", {"job_id": self._job_id, "generation": gen, "population_best": best}
            )

        self._evolution = GepaEvolution(
            job_id=self._job_id,
            base_skill_text=self._base_skill,
            dataset=self._dataset,
            config=self._config,
            emit=emit,
            should_cancel=lambda: self._cancel_flag,
            sidecar_version=__version__,
        )
        result = self._evolution.run()
        return {
            "job_id": result.job_id,
            "status": result.status,
            "generations_run": result.generations_run,
            "best_candidate_id": result.best_candidate_id,
            "started_at": result.started_at,
            "ended_at": result.ended_at,
            "sidecar_version": result.sidecar_version,
            "candidate_count": len(result.candidates),
            "lm_fallback_note": result.lm_fallback_note,
        }

    def cancel(self, params: Dict[str, Any]) -> Dict[str, Any]:
        self._cancel_flag = True
        return {"ok": True, "job_id": self._job_id}


def build_registry(server: SidecarServer) -> MethodRegistry:
    registry = MethodRegistry()
    registry.register("initialize", server.initialize)
    registry.register("evolve", server.evolve)
    registry.register("cancel", server.cancel)
    return registry


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="gepa_sidecar", description="GEPA evolution sidecar (T12)")
    parser.add_argument("--job", required=True, help="job id (evo_<yyyymmdd>_<seq>)")
    parser.add_argument("--scratch", default=".", help="sandbox scratch dir (SEC-GEPA-01)")
    parser.add_argument("--version", action="store_true", help="print version and exit")
    args = parser.parse_args(argv)

    if args.version:
        print(__version__)
        return 0

    protocol = SidecarProtocol(sys.stdin, sys.stdout, logger=lambda m: sys.stderr.write(m + "\n"))
    server = SidecarServer(args.job, args.scratch, protocol)
    registry = build_registry(server)
    return serve(registry, protocol)


if __name__ == "__main__":
    raise SystemExit(main())
