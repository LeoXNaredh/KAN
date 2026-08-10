# @kan/plugin-bluetooth-py

Driver de Bluetooth BLE central-mode **real** (fix de auditoría de backend #5) — sidecar Python vía [`bleak`](https://github.com/hbldh/bleak), corriendo sobre `kan-plugin-sdk-py` (ADR-056). Reemplaza al `FakeBluetoothTransport` de `@kan/plugin-bluetooth-generic` como el camino real para escanear/leer/escribir periféricos BLE.

## Por qué un sidecar Python (y no bleno / Web Bluetooth)

Tres opciones evaluadas para este fix:

- **`bleno`** (Node) — descartado: es BLE modo **peripheral** (hace que la máquina *actúe como* un dispositivo BLE), no **central** (escanear y conectarse a periféricos), que es lo que este plugin necesita. No aplica al caso de uso, más allá de cualquier problema de binding nativo.
- **Web Bluetooth** — descartado: es una API de navegador (`navigator.bluetooth`), pensada para una página web con gesto explícito del usuario por conexión. No hay forma directa de usarla desde un proceso Node en el main de Electron, que es donde corre el Edge Agent.
- **Sidecar Python + `bleak`** — la opción viable. `bleak` es multiplataforma y no requiere compilar ningún binding nativo (a diferencia de `@abandonware/noble`, que sí lo requiere del lado Node y fue la razón original por la que `plugin-bluetooth-generic` quedó con `FakeBluetoothTransport` como default — ver su README). Esto ya estaba documentado como "Fase 2" ahí mismo, y ADR-056 dejó lista toda la infraestructura de sidecars (`kan-plugin-sdk-py`, `SidecarProxyPlugin`, `SidecarWsHost`) para exactamente este tipo de caso.

## Capabilities

Misma superficie que `@kan/plugin-bluetooth-generic` (mismos nombres/severidades — el LLM no distingue cuál está registrado):

- `scan_bluetooth_devices()` — read-only
- `read_characteristic(address, serviceUuid, characteristicUuid)` — read-only
- `write_characteristic(address, serviceUuid, characteristicUuid, value: hex string)` — irreversible-material por defecto
- `disconnect_bluetooth_device(address)` — reversible

## Estructura

- `src/ble_transport.py` — `BluetoothTransportPort` (ABC) + `BleakBluetoothTransport` (real, `bleak` importado perezosamente).
- `src/bluetooth_plugin.py` — `BluetoothPlugin(KanDeviceDriverPlugin)`, el driver en sí.
- `tests/fake_ble_transport.py` — doble de test sin hardware BLE real (ADR-012).
- `tests/test_integration_runner.py` — punta a punta contra `kan_plugin_sdk_py.runner` real, sobre un host WS fake en loopback.

## Uso

Este paquete se distribuye igual que `plugin-vision-py`: como paquete sidecar instalable vía `PluginInstaller` (ADR-056) una vez publicado a un catálogo real. Mientras no hay un catálogo Supabase con contenido real desplegado, `apps/desktop` lo registra como sidecar **empaquetado** (no descargado) apuntando directo a este directorio del monorepo — ver el comentario junto a `registerBundledBluetoothSidecar()` en `apps/desktop/src/main/index.ts`. Requiere Python 3.10+ instalable en el equipo (mismo prerequisito que `plugin-vision-py`); sin Python disponible, el registro falla con un aviso claro y el resto del Edge Agent sigue funcionando igual (mismo criterio try/catch que ESP32/Raspberry Pi).

## Tests

```
pip install -r requirements.txt
pip install pytest pytest-asyncio websockets
pytest
```
