# @kan/plugin-serial-generic

Puerto serial genérico — para cualquier dispositivo que hable ASCII/texto línea por línea sobre COM/ttyUSB y **no** tenga ya un protocolo fijo cubierto por otro plugin (ESP32 tiene su propio JSON, G-code tiene su propio texto, Modbus RTU tiene su propio framing binario). Reusa `@kan/serial-line-transport` (el mismo transporte real que ya usan `plugin-esp32-arduino`/`plugin-gcode`) — sin duplicar `serialport` de nuevo.

No asume qué hace una línea. `send_line` es `irreversible-material` por defecto (pide confirmación) hasta que el usuario lo reclasifique en el panel **Safety Policy**.

## Capabilities

- `send_line(line)` — irreversible-material por defecto.
- `read_last_lines()` — read-only. Devuelve hasta las últimas 50 líneas recibidas (buffer en memoria).

Un "dispositivo" es un puerto serial configurado. Sin targets — como el dispositivo entero es el target implícito (mismo caso que `plugin-ws-generic`: no hay sub-canales direccionables, a diferencia de MQTT con sus topics).

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que el resto de los plugins de hardware). Para habilitarlo:

```ts
import { SerialGenericDevicePlugin } from "@kan/plugin-serial-generic";

await agent.registerPlugin(new SerialGenericDevicePlugin());
```

## Configuración — `KAN_SERIAL_TARGETS`

`nombre|puerto|baudRate` separados por coma — baudRate opcional (default 9600, el más universal en RS-232/USB-serial clásico):

```
KAN_SERIAL_TARGETS=sensor1|COM3
KAN_SERIAL_TARGETS=sensor1|COM3|115200,arduino_viejo|COM4
```

**Nunca escanea** — a diferencia de `plugin-esp32-arduino` (que puede escanear todos los puertos porque su propio firmware responde un ping inofensivo que cualquier otro dispositivo simplemente ignora), un dispositivo serial genérico no tiene protocolo fijo: mandarle bytes a un puerto desconocido es un riesgo real, no hipotético — mismo motivo por el que `plugin-gcode` tampoco escanea.

`discover()` solo confirma que el puerto configurado abre — no que haya un dispositivo real del otro lado hablando algo coherente (no hay forma genérica de confirmar eso sin asumir un protocolo).

## Sin hardware físico probado en esta sesión

`NodeSerialTransport` (de `@kan/serial-line-transport`) ya tiene uso real y probado como dependencia de `plugin-esp32-arduino`/`plugin-gcode` — no se duplicó esa cobertura acá. Lo que sí se probó de punta a punta con el transporte real (no un fake) fue el caso "sin hardware conectado": `open()` sobre un puerto COM inexistente rechaza limpio, sin colgarse. Un puerto serial/USB físico o virtual no estuvo disponible en este entorno de desarrollo — mismo caso ya documentado para RTU serial en `plugin-modbus` y para hardware real en `plugin-esp32-arduino`/`plugin-gcode`.

## Probarlo de verdad

1. Conectá cualquier dispositivo serial (Arduino con un sketch simple, un sensor USB-serial, etc.) y anotá su puerto.
2. Fijá `KAN_SERIAL_TARGETS` con ese puerto y el baudRate que use tu dispositivo.
3. Registrá el plugin (paso anterior) y arrancá el Edge Agent — debería descubrir el puerto.
4. Desde el chat, pedí `read_last_lines` para ver qué está mandando el dispositivo (si algo).
5. Pedí `send_line` con un texto — debería pedir confirmación en la app de escritorio (ADR-004), no ejecutarse solo.
6. Verificá en `GET /v1/audit` del Gateway que la invocación quedó registrada.
