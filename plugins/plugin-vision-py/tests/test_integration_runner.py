"""Primera prueba real de que SDK + protocolo + un plugin concreto
encajan de punta a punta: levanta `kan_plugin_sdk_py.runner._run()` real
contra un host WS fake en loopback (Python, sin tocar TypeScript) y
ejercita discover/connect/invoke tal como lo haría el `SidecarWsHost` del
Edge Agent (Fase 3)."""

import asyncio
import json
from typing import Any
from uuid import uuid4

import pytest
import websockets
from kan_plugin_sdk_py.runner import _run

from src.vision_plugin import DEVICE_ID, VisionPlugin

from .fake_frame_source import FakeFrameSource

TOKEN = "integration-test-token"


async def _run_host_scenario(server_ready: asyncio.Event, received: dict[str, Any], port_holder: list[int]):
    async def handler(ws):
        received["hello"] = json.loads(await ws.recv())

        await ws.send(json.dumps({"type": "discover", "requestId": str(uuid4())}))
        received["discover.result"] = json.loads(await ws.recv())

        await ws.send(json.dumps({"type": "connect", "requestId": str(uuid4()), "deviceId": DEVICE_ID}))
        received["connect.result"] = json.loads(await ws.recv())

        await ws.send(
            json.dumps(
                {
                    "type": "invoke",
                    "requestId": str(uuid4()),
                    "deviceId": DEVICE_ID,
                    "capability": "detect_objects",
                    "input": {},
                }
            )
        )
        received["invoke.result"] = json.loads(await ws.recv())

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
async def test_plugin_vision_py_end_to_end_contra_el_runner_real():
    plugin = VisionPlugin(frame_source=FakeFrameSource(openable=True))
    received: dict[str, Any] = {}
    port_holder: list[int] = []
    server_ready = asyncio.Event()

    server_task = asyncio.create_task(_run_host_scenario(server_ready, received, port_holder))
    await server_ready.wait()
    port = port_holder[0]

    exit_code = await asyncio.wait_for(_run(plugin, f"ws://127.0.0.1:{port}", TOKEN), timeout=5)

    server_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await server_task

    assert exit_code == 0
    assert received["hello"]["pluginId"] == "kan-plugin-vision-py"
    assert received["discover.result"]["devices"][0]["id"] == DEVICE_ID
    assert received["connect.result"]["ok"] is True
    assert received["connect.result"]["capabilities"][0]["name"] == "detect_objects"
    assert received["invoke.result"]["result"] == {"success": True, "data": {"objects": []}}
