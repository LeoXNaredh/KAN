# @kan/plugin-micropython

Plataforma A del sistema de backup/restore de proyecto (docs/06): boards
MicroPython (Raspberry Pi Pico, ESP32 flasheado con MicroPython, etc.) —
backup/restore de código fuente **real y legible**, a diferencia de
`@kan/plugin-esp32-arduino` (firmware Arduino C++ propio, wire protocol JSON)
o los drivers de PLC (solo guardan la configuración que KAN tiene sobre el
dispositivo, nunca el programa en sí).

No expone ninguna capability de control (GPIO, etc.) — solo
`ProjectDriverPort`, compuesto vía `createProjectCapabilities()`/
`handleProjectCapability()` (`@kan/plugin-sdk-ts`):

- `project_list_files` — read-only
- `project_read_file(path)` — read-only
- `project_save_snapshot(label?)` — read-only (no toca el dispositivo, solo lee y sube)
- `project_restore_snapshot(snapshotId)` — irreversible-material (sobrescribe archivos reales, pide confirmación)

## Cómo habla con el board

Por **raw REPL** (el mismo protocolo que usan `mpremote`/`ampy`/`rshell`), a
nivel de bytes crudos sobre `serialport` directo — a propósito, no
`@kan/serial-line-transport` (`LineConnection`): el framing del raw REPL
(`OK<stdout>\x04<stderr>\x04>`) no es línea-por-línea, cualquier byte puede
aparecer en medio de una respuesta. Ver `RawSerialTransportPort.ts` y
`rawRepl.ts`.

Al conectar (`connect()`), el driver interrumpe lo que esté corriendo (dos
Ctrl-C) y entra a raw REPL (Ctrl-A) — se queda ahí para toda la sesión, así
que **el programa del usuario (`main.py`) queda pausado mientras el
dispositivo sigue "conectado" en KAN**, mismo trade-off que `mpremote`/`ampy`.
Vuelve a la REPL amigable recién en `disconnect()` (Ctrl-B).

Todo el contenido de archivo viaja en base64 (`snippets.ts`) — necesario
porque el propio contenido podría contener el byte `\x04` que el protocolo
usa como terminador.

## Descubrimiento

Por defecto prueba cada puerto serial disponible intentando entrar a raw
REPL (si no responde el banner esperado en ~800ms, no es un board
MicroPython o está ocupado). Para saltarte el escaneo: `KAN_MICROPYTHON_PORT`
(ej. `KAN_MICROPYTHON_PORT=COM4`).

## Uso

Se registra en `apps/desktop/src/main/index.ts` con import dinámico +
try/catch (mismo criterio que `@kan/plugin-esp32-arduino`/`@kan/plugin-modbus`
— ver ese README para el estado conocido de `serialport` bajo el ABI de
Electron) — un fallo de carga no debe tumbar el resto del Edge Agent para
quien no tiene un board MicroPython conectado. Necesita además una instancia
de `SnapshotTransportPort` (`GatewaySnapshotTransport`, `apps/desktop`) para
subir/bajar snapshots — sin default, se inyecta por constructor:

```ts
new MicroPythonPlugin(undefined, new GatewaySnapshotTransport(configStore, edgeAgentId));
```

## Probarlo con hardware real

Esta sesión de desarrollo no tuvo un board MicroPython físico disponible —
el driver está construido y testeado contra un transporte serial simulado
(`FakeRawSerialTransport`/`FakeMicroPythonDevice`, que implementa el
protocolo raw REPL de verdad contra un filesystem en memoria), pero la
validación con hardware real queda pendiente. Pasos para cuando tengas la
placa a mano:

1. Flasheá MicroPython en tu Pico/ESP32 si todavía no lo tiene (ver
   [micropython.org/download](https://micropython.org/download/)).
2. Conectala por USB y anotá el puerto (ej. `COM4` en Windows,
   `/dev/ttyACM0` en Linux).
3. Arrancá el Edge Agent (`apps/desktop`) con el plugin registrado. Si el
   escaneo automático no la encuentra, fijá `KAN_MICROPYTHON_PORT`.
4. Desde `/dispositivo/[id]` en `apps/web`, probá "Nuevo snapshot" — debería
   listar `main.py`/`boot.py`/lo que tenga el filesystem y guardarlos.
5. Editá algo en el board a mano (o restaurá un snapshot viejo) y confirmá
   que "Restaurar" lo trae de vuelta tal cual.
