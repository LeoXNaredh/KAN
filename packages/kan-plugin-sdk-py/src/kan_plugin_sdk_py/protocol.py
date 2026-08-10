"""Espejo a mano de packages/plugin-contract/src/sidecarProtocol.ts (ADR-056).

Sin codegen cruzado TS<->Python: este módulo reimplementa a mano los
mismos mensajes. `tests/test_protocol.py` lee el mismo fixture JSON que
`sidecarProtocol.test.ts` (`packages/plugin-contract/src/sidecarProtocolFixtures.json`)
para detectar drift entre los dos lados.
"""

from typing import Any, Optional

SIDECAR_PROTOCOL_VERSION = "1.0.0"


def sidecar_hello(*, plugin_id: str, plugin_version: str, token: str) -> dict[str, Any]:
    return {
        "type": "sidecar_hello",
        "protocolVersion": SIDECAR_PROTOCOL_VERSION,
        "pluginId": plugin_id,
        "pluginVersion": plugin_version,
        "token": token,
    }


def discover_result(*, request_id: str, devices: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "discover.result", "requestId": request_id, "devices": devices}


def connect_result(
    *, request_id: str, ok: bool, capabilities: Optional[list[dict[str, Any]]] = None, error: Optional[str] = None
) -> dict[str, Any]:
    message: dict[str, Any] = {"type": "connect.result", "requestId": request_id, "ok": ok}
    if capabilities is not None:
        message["capabilities"] = capabilities
    if error is not None:
        message["error"] = error
    return message


def disconnect_result(*, request_id: str, ok: bool) -> dict[str, Any]:
    return {"type": "disconnect.result", "requestId": request_id, "ok": ok}


def invoke_result(*, request_id: str, result: dict[str, Any]) -> dict[str, Any]:
    return {"type": "invoke.result", "requestId": request_id, "result": result}


def list_targets_result(*, request_id: str, targets: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "list_targets.result", "requestId": request_id, "targets": targets}


def heartbeat(*, at: str) -> dict[str, Any]:
    return {"type": "heartbeat", "at": at}


# Mensajes que el runner recibe del Edge Agent (Edge -> sidecar) — sin
# builder propio, se parsean tal cual llegan por WS; documentados acá para
# que el shape de cada `type` esperado quede en un solo lugar por lado.
EDGE_TO_SIDECAR_TYPES = frozenset(
    {"sidecar_hello_ack", "discover", "connect", "disconnect", "invoke", "list_targets", "shutdown"}
)
SIDECAR_TO_EDGE_TYPES = frozenset(
    {
        "sidecar_hello",
        "discover.result",
        "connect.result",
        "disconnect.result",
        "invoke.result",
        "list_targets.result",
        "heartbeat",
    }
)
