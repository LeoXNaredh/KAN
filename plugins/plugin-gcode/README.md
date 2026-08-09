# @kan/plugin-gcode

Driver genérico de máquinas que hablan G-code sobre Serial/USB o WiFi/TCP: impresoras 3D (firmware Marlin), CNC y láseres (firmware GRBL). Mismo `DeviceDriverPort` que `@kan/plugin-esp32-arduino`, reutilizando el mismo transporte serial y de red (`@kan/serial-line-transport`, ambos extraídos de ese plugin) — el protocolo de cable es distinto (texto G-code en vez de JSON), ver [`src/gcodeProtocol.ts`](./src/gcodeProtocol.ts).

No asume qué máquina está conectada. `move_axis`/`set_temperature`/`send_raw_gcode` son `irreversible-material` por defecto (piden confirmación) hasta que el usuario clasifique cada eje/componente en el panel **Safety Policy**. `start_spindle_or_laser` es `safety-critical` — el techo de severidad del sistema, porque encender un spindle o un láser es de las acciones físicas más peligrosas que KAN puede disparar. `emergency_stop`, `stop_spindle_or_laser` y `pause_print` son deliberadamente `reversible`: **parar/pausar nunca debe quedar detrás de una confirmación** — es la acción de menor fricción posible, siempre.

## Capabilities

- `home_axes(axes?)` — irreversible-material. `G28` (todos los ejes) o `G28 <ejes>` si se especifica.
- `move_axis(axis, distanceMm, feedRateMmPerMin?)` — irreversible-material. Siempre un movimiento **relativo** (`G91`/`G0`/`G90`) — nunca mueve a una coordenada absoluta, evita sorpresas si la posición actual no era la esperada.
- `set_temperature(component: "hotend"|"bed", celsius)` — irreversible-material. `M104`/`M140` (fija y sigue, no espera a alcanzar la temperatura — `M109`/`M190` podrían tardar minutos y no encajan en un modelo de capability de request/response).
- `get_position()` — read-only. `M114`.
- `get_status()` — read-only. Temperaturas actuales/objetivo de hotend y cama (`M105`) más el estado de la impresión en curso, si hay una (`{status, currentLine, totalLines, percent, filename}` o `null`).
- `print_file(gcode, filename?)` — irreversible-material. Transmite el G-code **línea por línea por el mismo cable** (streaming/"modo host", igual que OctoPrint/Cura/Pronterface por defecto) — no usa la SD de la impresora (`M28`/`M29`/`M23`/`M24`), así que funciona en impresoras sin SD. Devuelve de inmediato (`{totalLines, filename}`) — la impresión corre en segundo plano; usá `get_status`/`pause_print`/`resume_print`/`cancel_print` para seguirla. Rechaza si ya hay una impresión en curso en ese dispositivo. Límite de 2.000.000 de caracteres de G-code por request (mismo criterio que el límite de imágenes en el chat).
- `pause_print()` — reversible. Deja de mandar líneas nuevas — no le manda nada a la máquina, la deja como está.
- `resume_print()` — irreversible-material. Retoma el streaming desde la línea siguiente a donde quedó.
- `cancel_print()` — reversible. Deja de mandar líneas nuevas y libera el dispositivo para un `print_file` nuevo — no homea ni apaga temperaturas por su cuenta (eso lo decidís vos con las capabilities que ya existen).
- `start_spindle_or_laser(direction?: "cw"|"ccw", power?)` — **safety-critical**. `M3`/`M4`, con `S<power>` si se especifica.
- `stop_spindle_or_laser()` — reversible. `M5`.
- `emergency_stop()` — reversible. `M112` — nota: en Marlin esto detiene el firmware por completo y puede requerir reiniciar la placa.
- `send_raw_gcode(line)` — irreversible-material. Para cualquier comando no cubierto arriba.

### Por qué streaming y no SD (P9, ADR-043)

Imprimir "de verdad" en Marlin tiene dos caminos: subir el archivo a la SD de la impresora y arrancarlo desde ahí (`M28`/escribir/`M29`/`M23`/`M24`, progreso vía `M27`), o transmitirlo por el mismo cable línea por línea esperando el `ok` de cada una ("modo host"). Este plugin usa el segundo — mismo primitivo que ya usan `home_axes`/`move_axis`/etc. (`sendGcodeLine`), sin necesitar una máquina de estados de escritura a SD nueva, y funciona en impresoras sin SD. La contra, explícita: si se corta la conexión a mitad de una impresión larga, se pierde el streaming — no hay resume automático tipo SD. El estado del job (`printJobs`) vive solo en memoria del plugin, no persiste: un reinicio del Edge Agent en medio de una impresión pierde el tracking (la impresora sigue haciendo lo que ya se le mandó, pero KAN deja de saber en qué línea iba).

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que ESP32/Bluetooth/MQTT). Para habilitarlo:

```ts
import { GcodeDevicePlugin } from "@kan/plugin-gcode";

await agent.registerPlugin(new GcodeDevicePlugin());
```

## Configuración

- `KAN_GCODE_SERIAL_PORT=COM3` — un puerto serial (Serial/USB). No escanea — ver "Por qué no escanea" abajo.
- `KAN_GCODE_WIFI_HOST` + `KAN_GCODE_WIFI_PORT` — host y puerto de un bridge serial-a-red (WiFi/TCP), si tu máquina tiene uno. Sin puerto por defecto asumido a propósito — a diferencia del 8266 del propio firmware de ESP32, no hay un puerto estándar entre firmwares/bridges de G-code; sin ambas variables, no intenta conectarse por red.
- `KAN_GCODE_BAUD_RATE` opcional (default 115200, el más común en Marlin/GRBL) — aplica solo al camino serial.

Ambos transportes pueden estar configurados a la vez — `discover()` reporta hasta dos dispositivos, uno por transporte, si ambos responden.

**`discover()` nunca escanea puertos/hosts sin configurar** — a diferencia de `plugin-esp32-arduino`, que puede escanear todos los puertos seriales porque su propio firmware responde un "ping" JSON inofensivo que cualquier otro dispositivo simplemente ignora. Acá no hay ese lujo: Marlin y GRBL no comparten un comando de identificación común, y mandarle texto G-code a un puerto/host desconocido (que podría ser cualquier otra cosa) es un riesgo real, no hipotético. Por eso `discover()` solo abre lo que el usuario configuró explícitamente y confirma que la conexión abre — **no** que la máquina conectada hable G-code de verdad. Si configurás mal un puerto/host, el error aparece recién al invocar una capability, no antes.

## Probarlo con hardware real

Esta sesión de desarrollo no tuvo una impresora 3D/CNC/láser física disponible — el driver está construido y testeado contra un firmware simulado (`FakeGcodeSerialTransport`/`FakeGcodeNetworkTransport`), pero la validación con hardware real queda pendiente.

1. Conectá la máquina por USB (anotá el puerto: `COM3` en Windows, `/dev/ttyUSB0` en Linux) o por un bridge de red si tenés uno (anotá host y puerto).
2. Registrá el plugin (paso anterior) y fijá `KAN_GCODE_SERIAL_PORT` y/o `KAN_GCODE_WIFI_HOST`/`KAN_GCODE_WIFI_PORT`.
3. Arrancá el Edge Agent (`apps/desktop`) — debería descubrir y poder conectar la máquina.
4. Clasificá los ejes (X/Y/Z) y componentes (hotend/bed) que vayas a usar en el panel **Safety Policy** de la app de escritorio.
5. Probá `get_status`/`get_position` desde el chat (read-only, no deberían pedir confirmación) y después `move_axis` con una distancia chica (debería pedir confirmación si el eje sigue con el default `irreversible-material`).
6. Probá un `print_file` con un G-code chico y de bajo riesgo (ej. unos `G28`/`G1` sin extrusión), seguido de `get_status` para ver el progreso, `pause_print`/`resume_print`, y `cancel_print`.
7. Si tu máquina tiene spindle/láser, probá `start_spindle_or_laser` — **siempre** debe pedir confirmación (`safety-critical`, no bajable a un solo intento accidental) — y confirmá que `stop_spindle_or_laser`/`emergency_stop`/`pause_print`/`cancel_print` se ejecutan sin pedir nada.
8. Verificá en `GET /v1/audit` del Gateway que las invocaciones quedaron registradas.
