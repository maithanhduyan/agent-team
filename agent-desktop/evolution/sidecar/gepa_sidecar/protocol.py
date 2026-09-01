"""JSON-RPC 2.0 over stdio — line-delimited framing (T09 §4.3, ADR-009).

Zero-dependency implementation (stdlib only) so the sidecar runs in the
pinned sandbox with no runtime `pip install` (SEC-GEPA-10). Every
message is a single line of JSON (JSON-RPC 2.0 object); the Node runner
uses the identical framing. Schema-validated on both sides against
`evolution/contracts/gepa-rpc.schema.json` (the Node side runs the
schema check; this module does structural checks for the subset the
sidecar needs and rejects unknown methods).

The sidecar is **request/response only** — it never initiates actions
(no callbacks, no webhooks, no command channel; ADR-009 §6.3.1).
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable, Dict, List, Optional, TextIO

JSON = Any

# JSON-RPC error codes (https://www.jsonrpc.org/specification).
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


class RpcError(Exception):
    """A JSON-RPC error that maps to an `error` response."""

    def __init__(self, code: int, message: str, data: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"code": self.code, "message": self.message}
        if self.data is not None:
            out["data"] = self.data
        return out


class SidecarProtocol:
    """Read/write JSON-RPC messages on a line-delimited stream."""

    def __init__(self, stdin: TextIO, stdout: TextIO, logger: Callable[[str], None] = lambda _: None):
        self._in = stdin
        self._out = stdout
        self._log = logger

    # -- framing -----------------------------------------------------
    def read_message(self) -> Optional[Dict[str, Any]]:
        """Read the next line and parse it as a JSON-RPC message.
        Returns None on EOF. Raises RpcError on malformed JSON."""
        line = self._in.readline()
        if line == "":
            return None  # EOF — peer closed the stream
        line = line.strip()
        if not line:
            return self.read_message()
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RpcError(PARSE_ERROR, f"parse error: {exc}") from exc
        if not isinstance(msg, dict):
            raise RpcError(INVALID_REQUEST, "message is not a JSON object")
        if msg.get("jsonrpc") != "2.0":
            raise RpcError(INVALID_REQUEST, "jsonrpc must be '2.0'")
        if not isinstance(msg.get("method"), str) or not msg["method"]:
            raise RpcError(INVALID_REQUEST, "method is required")
        return msg

    def write_message(self, msg: Dict[str, Any]) -> None:
        """Serialize + emit one JSON-RPC message as a single line."""
        self._out.write(json.dumps(msg, ensure_ascii=False, separators=(",", ":")) + "\n")
        self._out.flush()

    # -- helpers -----------------------------------------------------
    def send_response(self, request_id: Any, result: Any) -> None:
        self.write_message({"jsonrpc": "2.0", "id": request_id, "result": result})

    def send_error(self, request_id: Any, error: RpcError) -> None:
        self.write_message({"jsonrpc": "2.0", "id": request_id, "error": error.to_dict()})

    def send_notification(self, method: str, params: Dict[str, Any]) -> None:
        self.write_message({"jsonrpc": "2.0", "method": method, "params": params})


class MethodRegistry:
    """Dispatch incoming requests by method name to handlers."""

    def __init__(self) -> None:
        self._handlers: Dict[str, Callable[[Dict[str, Any]], Any]] = {}

    def register(self, method: str, handler: Callable[[Dict[str, Any]], Any]) -> None:
        self._handlers[method] = handler

    def handle(self, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle one message; returns the response dict, or None for
        a notification (no id). Raises RpcError for unknown methods."""
        method = msg["method"]
        params = msg.get("params") or {}
        if not isinstance(params, dict):
            raise RpcError(INVALID_PARAMS, "params must be an object")
        if method not in self._handlers:
            raise RpcError(METHOD_NOT_FOUND, f"method not found: {method}")
        result = self._handlers[method](params)
        return result


def serve(registry: MethodRegistry, protocol: SidecarProtocol) -> int:
    """Read requests until EOF, dispatching to the registry. Returns the
    process exit code (0 on clean exit, 1 on protocol-level failure)."""
    try:
        while True:
            try:
                msg = protocol.read_message()
            except RpcError as exc:
                protocol.send_error(None, exc)  # notification-style error (no id)
                continue
            if msg is None:
                return 0
            request_id = msg.get("id")
            try:
                result = registry.handle(msg)
                if request_id is not None:
                    protocol.send_response(request_id, result)
            except RpcError as exc:
                if request_id is not None:
                    protocol.send_error(request_id, exc)
                else:
                    protocol._log(f"[sidecar] error on notification: {exc.message}")
            except Exception as exc:  # noqa: BLE001 — report, keep serving
                protocol._log(f"[sidecar] internal error: {exc!r}")
                if request_id is not None:
                    protocol.send_error(request_id, RpcError(INTERNAL_ERROR, str(exc)))
    except KeyboardInterrupt:
        return 0


# Keep sys import available for `python -m gepa_sidecar` console entry.
_ = sys
