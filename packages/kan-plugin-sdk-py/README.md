# kan-plugin-sdk-py

SDK Python para plugins tipo **sidecar** de KAN (ADR-056, `docs/00-analisis-y-decisiones.md`). Equivalente Python de [`@kan/plugin-sdk-ts`](../plugin-sdk-ts) — mismos conceptos (`KanDeviceDriverPlugin`, `CapabilityDescriptor`, permisos deny-by-default), pero para plugins que corren como **proceso separado** (visión artificial, CAD, robótica — cualquier cosa que no deba vivir dentro del proceso del Edge Agent/Electron, ADR-003).

## Por qué existe

Los plugins `runtime: "in-process-ts"` (ESP32, Modbus, etc.) corren en el mismo proceso que el Edge Agent — no sirven cuando la dependencia real (OpenCV, un driver de CAD) no tiene sentido en Node o cuando aislar el proceso importa. `runtime: "python-sidecar"` es la otra mitad del contrato ya definido en `packages/plugin-contract/src/manifest.ts`, sin implementación hasta este incremento.

## Cómo se comunica con el Edge Agent

El Edge Agent (Node) abre un WebSocket en `127.0.0.1` **antes** de spawnear este proceso y le pasa la URL y un token de un solo uso por variables de entorno (`KAN_SIDECAR_WS_URL`, `KAN_SIDECAR_TOKEN`) — nunca por línea de comandos. El protocolo completo (mensajes, correlación por `requestId`, versión) vive en [`packages/plugin-contract/src/sidecarProtocol.ts`](../plugin-contract/src/sidecarProtocol.ts); `src/kan_plugin_sdk_py/protocol.py` es su espejo a mano del lado Python — sin codegen cruzado, con un fixture JSON compartido (`sidecarProtocolFixtures.json`) que ambos lados testean para detectar drift.

Un plugin nunca ve el socket directamente — `runner.py` es el único módulo que habla WS; el plugin solo implementa `KanDeviceDriverPlugin`.

## Escribir un plugin nuevo

Un plugin sidecar es un directorio con:

```
mi-plugin/
├── manifest.json        # mismo shape que PluginManifest, runtime: "python-sidecar"
├── requirements.txt      # incluye kan-plugin-sdk-py
├── main.py                # expone create_plugin()
└── src/...
```

`main.py`:

```python
from kan_plugin_sdk_py import KanDeviceDriverPlugin, PluginManifest, PluginPermissions

class MiPlugin(KanDeviceDriverPlugin):
    def __init__(self):
        self.manifest = PluginManifest(
            id="kan-plugin-mi-plugin",
            version="0.1.0",
            display_name="Mi Plugin",
            kind="device-driver",
            runtime="python-sidecar",
            permissions=PluginPermissions(devices=["mi-dispositivo"], network=False, filesystem=[]),
        )

    async def discover(self): ...
    async def connect(self, device_id): ...
    async def disconnect(self, device_id): ...
    def get_capabilities(self, device_id): ...
    async def invoke(self, device_id, capability_name, input_value): ...

def create_plugin() -> KanDeviceDriverPlugin:
    return MiPlugin()
```

Ver [`plugins/plugin-vision-py`](../../plugins/plugin-vision-py) para un ejemplo completo con tests.

## Correr el runner manualmente (debug)

```bash
KAN_SIDECAR_WS_URL=ws://127.0.0.1:PUERTO KAN_SIDECAR_TOKEN=... python -m kan_plugin_sdk_py.runner /ruta/al/plugin
```

Sin lógica de reconexión a propósito — si el socket cae, el proceso termina. Sirve a una sola instancia del Edge Agent durante su ciclo de vida, no está pensado para sobrevivir un restart del host.

## Tests

```bash
python -m venv .venv && .venv/Scripts/activate  # o source .venv/bin/activate
pip install -e ".[dev]"
pytest
```

No corre bajo `pnpm turbo run test` (ese pipeline solo conoce paquetes con `package.json`) — es un job de CI separado.
