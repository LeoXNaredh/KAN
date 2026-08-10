"""WS real en loopback (ADR-012: el único módulo que toca un socket real
se prueba contra el real, no contra un doble) — un `websockets.serve` en
`127.0.0.1:0` hace de doble del `SidecarWsHost` del lado Node (Fase 3) y
ejercita `runner._run()` de punta a punta: hello, discover, connect,
invoke, shutdown.
"""

import asyncio
import json
from typing import Any
from uuid import uuid4

import pytest
import websockets

from kan_plugin_sdk_py import (
    CapabilityDescriptor,
    CapabilityResult,
    DeviceDescriptor,
    KanDeviceDriverPlugin,
    PluginManifest,
    PluginPermissions,
)
from kan_plugin_sdk_py.runner import _run

TOKEN = "test-token-123"


class FakePlugin(KanDeviceDriverPlugin):
    def __init__(self) -> None:
        self.manifest = PluginManifest(
            id="kan-plugin-fake-py",
            version="0.1.0",
            display_name="Fake Python Plugin",
            kind="device-driver",
            runtime="python-sidecar",
            permissions=PluginPermissions(devices=["fake"], network=False, filesystem=[]),
        )
        self.loaded = False
        self.unloaded = False

    async def on_load(self) -> None:
        self.loaded = True

    async def on_unload(self) -> None:
        self.unloaded = True

    async def discover(self) -> list[DeviceDescriptor]:
        return [DeviceDescriptor(id="fake-0", name="Fake Device", kind="fake")]

    async def connect(self, device_id: str) -> None:
        if device_id != "fake-0":
            raise ValueError(f"Dispositivo desconocido: {device_id}")

    async def disconnect(self, device_id: str) -> None:
        return None

    def get_capabilities(self, device_id: str) -> list[CapabilityDescriptor]:
        return [CapabilityDescriptor(name="ping", description="Responde pong.", severity="read-only", supports_dry_run=False)]

    async def invoke(self, device_id: str, capability_name: str, input_value: Any) -> CapabilityResult:
        if capability_name == "ping":
            return CapabilityResult(success=True, data={"pong": True})
        return CapabilityResult(success=False, error=f"Capability desconocida: {capability_name}")


async def _run_server_scenario(server_ready: asyncio.Event, received: dict[str, Any], port_holder: list[int]):
    async def handler(ws):
        hello_raw = await ws.recv()
        hello = json.loads(hello_raw)
        received["hello"] = hello

        request_id = str(uuid4())
        await ws.send(json.dumps({"type": "discover", "requestId": request_id}))
        discover_response = json.loads(await ws.recv())
        received["discover.result"] = discover_response

        connect_request_id = str(uuid4())
        await ws.send(json.dumps({"type": "connect", "requestId": connect_request_id, "deviceId": "fake-0"}))
        connect_response = json.loads(await ws.recv())
        received["connect.result"] = connect_response

        invoke_request_id = str(uuid4())
        await ws.send(
            json.dumps(
                {
                    "type": "invoke",
                    "requestId": invoke_request_id,
                    "deviceId": "fake-0",
                    "capability": "ping",
                    "input": {},
                }
            )
        )
        invoke_response = json.loads(await ws.recv())
        received["invoke.result"] = invoke_response

        # Mensaje con forma inesperada — el runner debe ignorarlo, no tumbar la conexión.
        await ws.send(json.dumps({"type": "algo_desconocido"}))

        await ws.send(json.dumps({"type": "shutdown"}))

    server = await websockets.serve(handler, "127.0.0.1", 0)
    port_holder.append(server.sockets[0].getsockname()[1])
    server_ready.set()
    try:
        await asyncio.sleep(5)
    finally:
        server.close()
        await server.wait_closed()


@pytest.mark.asyncio
async def test_runner_end_to_end_contra_un_host_ws_real():
    plugin = FakePlugin()
    received: dict[str, Any] = {}
    port_holder: list[int] = []
    server_ready = asyncio.Event()

    server_task = asyncio.create_task(_run_server_scenario(server_ready, received, port_holder))
    await server_ready.wait()
    port = port_holder[0]

    exit_code = await asyncio.wait_for(_run(plugin, f"ws://127.0.0.1:{port}", TOKEN), timeout=5)

    server_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await server_task

    assert exit_code == 0
    assert plugin.loaded is True
    assert plugin.unloaded is True

    assert received["hello"]["type"] == "sidecar_hello"
    assert received["hello"]["token"] == TOKEN
    assert received["hello"]["pluginId"] == "kan-plugin-fake-py"

    assert received["discover.result"]["devices"] == [{"id": "fake-0", "name": "Fake Device", "kind": "fake"}]

    assert received["connect.result"]["ok"] is True
    assert received["connect.result"]["capabilities"][0]["name"] == "ping"

    assert received["invoke.result"]["result"] == {"success": True, "data": {"pong": True}}
