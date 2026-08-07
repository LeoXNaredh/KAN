# @kan/plugin-bluetooth-generic

Driver genérico de Bluetooth (BLE central-mode): escanea periféricos cercanos, lee/escribe características GATT por UUID. Mismo `DeviceDriverPort` que el resto de los plugins de hardware — el "dispositivo" es el adaptador Bluetooth de la máquina; cada periférico BLE encontrado por escaneo es un **target** direccionable por su `address` para `SafetyPolicyStore` (mismo mecanismo que los pines de `plugin-esp32-arduino`, sin tocar esa infraestructura).

No asume qué hay conectado a un periférico. `write_characteristic` es `irreversible-material` por defecto hasta que el usuario clasifique esa dirección explícitamente en el panel **Safety Policy**.

## Capabilities

- `scan_bluetooth_devices()` — read-only
- `read_characteristic(address, serviceUuid, characteristicUuid)` — read-only
- `write_characteristic(address, serviceUuid, characteristicUuid, value: hex string)` — irreversible-material por defecto
- `disconnect_bluetooth_device(address)` — reversible

## Estado del adaptador real — sin binding nativo en este entorno

Se intentó agregar `@abandonware/noble` (BLE central-mode para Node) siguiendo el protocolo acordado: **un solo intento**, sin depurar el entorno si fallaba. Falló — el binding nativo (`@abandonware/bluetooth-hci-socket`, vía `node-gyp`) requiere Visual Studio con el workload "Desktop development with C++", que no está instalado en esta máquina de desarrollo:

```
gyp ERR! find VS You need to install the latest version of Visual Studio
gyp ERR! find VS including the "Desktop development with C++" workload.
```

Por regla, no se intentó instalar Visual Studio Build Tools ni depurar más allá de este punto. **`FakeBluetoothTransport` queda como la implementación *por defecto* del plugin** (no solo para tests) — `BluetoothDevicePlugin` funciona igual, con periféricos simulados, hasta que exista un adaptador real.

## Fase 2 (no implementada): microservicio BLE en Python

Para BLE real en Windows sin depender de un binding nativo de Node, la vía queda documentada para un incremento futuro: un **sidecar en Python** usando [`bleak`](https://github.com/hbldh/bleak) (BLE multiplataforma, sin problemas de compilación en Windows), comunicándose con el Edge Agent vía RPC/WebSocket con un contrato de mensajes versionado.

Esto no es una idea nueva — es aplicar **ADR-003** (`docs/00`: *"Plugins de hardware/IA pesada corren fuera de proceso (sidecars), no in-process"*), ya decidido para exactamente este tipo de caso (BLE, visión artificial, CAD, robótica). `BluetoothTransportPort` ya está diseñado para que un adaptador que hable con ese sidecar (`RpcBluetoothTransport`, o como se llame) lo implemente sin tocar `BluetoothDevicePlugin` ni las capabilities — mismo principio de puertos/adaptadores que el resto del proyecto.

## Uso

No se registra automáticamente en `apps/desktop`. Para habilitarlo:

```ts
import { BluetoothDevicePlugin } from "@kan/plugin-bluetooth-generic";

await agent.registerPlugin(new BluetoothDevicePlugin());
```

Sin pasarle un transporte, usa `FakeBluetoothTransport([])` (sin dispositivos) — no falla, simplemente no encuentra nada al escanear, hasta que haya un adaptador real (o el sidecar de Fase 2) inyectado explícitamente.
