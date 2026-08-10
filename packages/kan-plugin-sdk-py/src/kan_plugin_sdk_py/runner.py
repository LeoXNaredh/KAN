"""Cliente WS real de un plugin sidecar (ADR-056). Uso:

    python -m kan_plugin_sdk_py.runner <plugin_dir>

Lee `KAN_SIDECAR_WS_URL`/`KAN_SIDECAR_TOKEN` del entorno (nunca por argv,
para que el token no quede visible en Task Manager/`ps`), conecta al
`SidecarWsHost` del Edge Agent (Node es el servidor WS, este proceso es
el cliente — ver `packages/plugin-contract/src/sidecarProtocol.ts`),
manda `sidecar_hello`, despacha cada request entrante al plugin cargado
por `loader.load_plugin()`, y manda `heartbeat` periódico.

Sin lógica de reconexión a propósito: este proceso sirve a una sola
instancia del Edge Agent durante su ciclo de vida — si el socket cae, el
proceso simplemente termina, no intenta reconectar.
"""

import asyncio
import datetime
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

import websockets

from . import protocol
from .device_driver import KanDeviceDriverPlugin
from .loader import PluginLoadError, load_plugin

logger = logging.getLogger("kan_plugin_sdk_py.runner")

HEARTBEAT_INTERVAL_SECONDS = 10


async def _dispatch(plugin: KanDeviceDriverPlugin, message: dict[str, Any]) -> dict[str, Any] | None:
    message_type = message.get("type")
    request_id = message.get("requestId")

    if message_type == "sidecar_hello_ack":
        return None

    if message_type == "discover":
        devices = await plugin.discover()
        return protocol.discover_result(request_id=request_id, devices=[d.to_wire() for d in devices])

    if message_type == "connect":
        device_id = message["deviceId"]
        try:
            await plugin.connect(device_id)
            capabilities = plugin.get_capabilities(device_id)
            return protocol.connect_result(
                request_id=request_id, ok=True, capabilities=[c.to_wire() for c in capabilities]
            )
        except Exception as error:  # noqa: BLE001 — cualquier falla de conexión de un plugin de terceros se reporta, no tumba el runner
            return protocol.connect_result(request_id=request_id, ok=False, error=str(error))

    if message_type == "disconnect":
        device_id = message["deviceId"]
        await plugin.disconnect(device_id)
        return protocol.disconnect_result(request_id=request_id, ok=True)

    if message_type == "invoke":
        result = await plugin.invoke(message["deviceId"], message["capability"], message.get("input"))
        return protocol.invoke_result(request_id=request_id, result=result.to_wire())

    if message_type == "list_targets":
        targets = plugin.list_targets(message["deviceId"])
        return protocol.list_targets_result(request_id=request_id, targets=[t.to_wire() for t in targets])

    # Mensaje con forma inesperada: se ignora sin tumbar la conexión, mismo
    # criterio que `WsConnectionManager` del lado TS.
    logger.warning("Mensaje con type desconocido, ignorado: %r", message_type)
    return None


async def _heartbeat_loop(ws: Any) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
        at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        await ws.send(json.dumps(protocol.heartbeat(at=at)))


async def _run(plugin: KanDeviceDriverPlugin, ws_url: str, token: str) -> int:
    async with websockets.connect(ws_url) as ws:
        await ws.send(
            json.dumps(
                protocol.sidecar_hello(plugin_id=plugin.manifest.id, plugin_version=plugin.manifest.version, token=token)
            )
        )
        await plugin.on_load()

        heartbeat_task = asyncio.create_task(_heartbeat_loop(ws))
        try:
            async for raw in ws:
                try:
                    message = json.loads(raw)
                except (TypeError, ValueError):
                    logger.warning("Mensaje no-JSON recibido, ignorado.")
                    continue

                if message.get("type") == "shutdown":
                    await plugin.on_unload()
                    return 0

                response = await _dispatch(plugin, message)
                if response is not None:
                    await ws.send(json.dumps(response))
        finally:
            heartbeat_task.cancel()

    return 0


def main() -> int:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)

    if len(sys.argv) < 2:
        print("Uso: python -m kan_plugin_sdk_py.runner <plugin_dir>", file=sys.stderr)
        return 1

    plugin_dir = Path(sys.argv[1]).resolve()

    try:
        plugin = load_plugin(plugin_dir)
    except PluginLoadError as error:
        # Sale ANTES de intentar conectar — el Edge Agent ve el exit del
        # proceso y reporta un error claro en vez de esperar el timeout de
        # hello completo (ver SidecarProxyPlugin, Fase 3).
        print(f"No se pudo cargar el plugin: {error}", file=sys.stderr)
        return 1

    ws_url = os.environ.get("KAN_SIDECAR_WS_URL")
    token = os.environ.get("KAN_SIDECAR_TOKEN")
    if not ws_url or not token:
        print("Faltan KAN_SIDECAR_WS_URL/KAN_SIDECAR_TOKEN en el entorno.", file=sys.stderr)
        return 1

    try:
        return asyncio.run(_run(plugin, ws_url, token))
    except (OSError, websockets.exceptions.WebSocketException) as error:
        print(f"Conexión con el Edge Agent perdida: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
