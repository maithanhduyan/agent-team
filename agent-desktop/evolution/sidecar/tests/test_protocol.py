"""Sidecar JSON-RPC protocol tests (T12, T09 §4.3)."""

import io
import json
import unittest

from gepa_sidecar.protocol import (
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    MethodRegistry,
    RpcError,
    SidecarProtocol,
    serve,
)


class ProtocolTest(unittest.TestCase):
    def test_round_trip_request_response(self):
        stdin = io.StringIO('{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}\n')
        stdout = io.StringIO()
        proto = SidecarProtocol(stdin, stdout)
        registry = MethodRegistry()
        registry.register("ping", lambda params: {"pong": True})
        code = serve(registry, proto)
        self.assertEqual(code, 0)
        msgs = [json.loads(l) for l in stdout.getvalue().splitlines()]
        self.assertEqual(msgs[0]["result"], {"pong": True})
        self.assertEqual(msgs[0]["id"], 1)

    def test_notification_gets_no_response(self):
        stdin = io.StringIO('{"jsonrpc":"2.0","method":"ping","params":{}}\n')
        stdout = io.StringIO()
        proto = SidecarProtocol(stdin, stdout)
        registry = MethodRegistry()
        registry.register("ping", lambda params: {"pong": True})
        serve(registry, proto)
        self.assertEqual(stdout.getvalue().strip(), "")

    def test_unknown_method_returns_error(self):
        stdin = io.StringIO('{"jsonrpc":"2.0","id":5,"method":"nope","params":{}}\n')
        stdout = io.StringIO()
        proto = SidecarProtocol(stdin, stdout)
        code = serve(registry_with_nothing(), proto)
        self.assertEqual(code, 0)
        msgs = [json.loads(l) for l in stdout.getvalue().splitlines()]
        self.assertEqual(msgs[0]["error"]["code"], METHOD_NOT_FOUND)

    def test_malformed_json_returns_parse_error(self):
        stdin = io.StringIO("this is not json\n")
        stdout = io.StringIO()
        proto = SidecarProtocol(stdin, stdout)
        code = serve(registry_with_nothing(), proto)
        self.assertEqual(code, 0)
        msgs = [json.loads(l) for l in stdout.getvalue().splitlines()]
        self.assertEqual(msgs[0]["error"]["code"], -32700)

    def test_missing_jsonrpc_version_rejected(self):
        stdin = io.StringIO('{"id":1,"method":"ping","params":{}}\n')
        stdout = io.StringIO()
        proto = SidecarProtocol(stdin, stdout)
        serve(registry_with_nothing(), proto)
        msgs = [json.loads(l) for l in stdout.getvalue().splitlines()]
        self.assertEqual(msgs[0]["error"]["code"], INVALID_REQUEST)

    def test_handler_rpc_error_propagates(self):
        def boom(params):
            raise RpcError(-32602, "bad params")

        stdin = io.StringIO('{"jsonrpc":"2.0","id":2,"method":"boom","params":{}}\n')
        stdout = io.StringIO()
        proto = SidecarProtocol(stdin, stdout)
        registry = MethodRegistry()
        registry.register("boom", boom)
        serve(registry, proto)
        msgs = [json.loads(l) for l in stdout.getvalue().splitlines()]
        self.assertEqual(msgs[0]["error"]["code"], -32602)
        self.assertEqual(msgs[0]["error"]["message"], "bad params")

    def test_notification_frame(self):
        stdin = io.StringIO()
        stdout = io.StringIO()
        proto = SidecarProtocol(stdin, stdout)
        proto.send_notification("candidate", {"candidate_id": "gen1-01"})
        msg = json.loads(stdout.getvalue().strip())
        self.assertEqual(msg["method"], "candidate")
        self.assertNotIn("id", msg)


def registry_with_nothing() -> MethodRegistry:
    return MethodRegistry()


if __name__ == "__main__":
    unittest.main()
