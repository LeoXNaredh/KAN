"""Misma prueba de punta a punta que plugin-vision-py/tests/test_integration_runner.py:
levanta `kan_plugin_sdk_py.runner._run()` real contra un host WS fake en
loopback (Python, sin tocar TypeScript) y ejercita discover/connect/invoke
tal como lo haría el `SidecarWsHost` del Edge Agent."""

import asyncio
import json
from typing import Any
from uuid import uuid4

import pytest
import websockets
from kan_plugin_sdk_py.runner import _run

from src.ble_transport import BleDeviceInfo
from src.bluetooth_plugin import ADAPTER_DEVICE_ID, BluetoothPlugin

from .fake_ble_transport import FakeBleDevice, FakeBluetoothTransport

TOKEN = "integration-test-token"
DEVICE_A = FakeBleDevice(info=BleDeviceInfo(address="AA:BB:CC:DD:EE:01", name="Sensor A"))


async def _run_host_scenario(server_ready: asyncio.Event, received: dict[str, Any], port_holder: list[int]):
    async def handler(ws):
        received["hello"] = json.loads(await ws.recv())

        await ws.send(json.dumps({"type": "discover", "requestId": str(uuid4())}))
        received["discover.result"] = json.loads(await ws.recv())

        await ws.send(json.dumps({"type": "connect", "requestId": str(uuid4()), "deviceId": ADAPTER_DEVICE_ID}))
        received["connect.result"] = json.loads(await ws.recv())

        await ws.send(
            json.dumps(
                {
                    "type": "invoke",
                    "requestId": str(uuid4()),
                    "deviceId": ADAPTER_DEVICE_ID,
                    "capability": "scan_bluetooth_devices",
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
async def test_plugin_bluetooth_py_end_to_end_contra_el_runner_real():
    plugin = BluetoothPlugin(transport=FakeBluetoothTransport([DEVICE_A]))
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
    assert received["hello"]["pluginId"] == "kan-plugin-bluetooth-py"
    assert received["discover.result"]["devices"][0]["id"] == ADAPTER_DEVICE_ID
    assert received["connect.result"]["ok"] is True
    capability_names = {c["name"] for c in received["connect.result"]["capabilities"]}
    assert capability_names == {
        "scan_bluetooth_devices",
        "read_characteristic",
        "write_characteristic",
        "disconnect_bluetooth_device",
    }
    assert received["invoke.result"]["result"]["success"] is True
    assert received["invoke.result"]["result"]["data"]["devices"] == [
        {"address": "AA:BB:CC:DD:EE:01", "name": "Sensor A", "rssi": None}
    ]
