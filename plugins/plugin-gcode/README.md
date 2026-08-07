# @kan/plugin-gcode

Driver genérico de máquinas que hablan G-code sobre Serial/USB: impresoras 3D (firmware Marlin), CNC y láseres (firmware GRBL). Mismo `DeviceDriverPort` que `@kan/plugin-esp32-arduino`, reutilizando el mismo transporte serial (`@kan/serial-line-transport`, extraído de ese plugin en este incremento) — el protocolo de cable es distinto (texto G-code en vez de JSON), ver [`src/gcodeProtocol.ts`](./src/gcodeProtocol.ts).

No asume qué máquina está conectada. `move_axis`/`set_temperature`/`send_raw_gcode` son `irreversible-material` por defecto (piden confirmación) hasta que el usuario clasifique cada eje/componente en el panel **Safety Policy**. `start_spindle_or_laser` es `safety-critical` — el techo de severidad del sistema, porque encender un spindle o un láser es de las acciones físicas más peligrosas que KAN puede disparar. `emergency_stop` y `stop_spindle_or_laser` son deliberadamente `reversible`: **parar nunca debe quedar detrás de una confirmación** — es la acción de menor fricción posible, siempre.

## Capabilities

- `home_axes(axes?)` — irreversible-material. `G28` (todos los ejes) o `G28 <ejes>` si se especifica.
- `move_axis(axis, distanceMm, feedRateMmPerMin?)` — irreversible-material. Siempre un movimiento **relativo** (`G91`/`G0`/`G90`) — nunca mueve a una coordenada absoluta, evita sorpresas si la posición actual no era la esperada.
- `set_temperature(component: "hotend"|"bed", celsius)` — irreversible-material. `M104`/`M140` (fija y sigue, no espera a alcanzar la temperatura — `M109`/`M190` podrían tardar minutos y no encajan en un modelo de capability de request/response).
- `get_position()` — read-only. `M114`.
- `start_spindle_or_laser(direction?: "cw"|"ccw", power?)` — **safety-critical**. `M3`/`M4`, con `S<power>` si se especifica.
- `stop_spindle_or_laser()` — reversible. `M5`.
- `emergency_stop()` — reversible. `M112` — nota: en Marlin esto detiene el firmware por completo y puede requerir reiniciar la placa.
- `send_raw_gcode(line)` — irreversible-material. Para cualquier comando no cubierto arriba.

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que ESP32/Bluetooth/MQTT). Para habilitarlo:

```ts
import { GcodeDevicePlugin } from "@kan/plugin-gcode";

await agent.registerPlugin(new GcodeDevicePlugin());
```

## Configuración

`KAN_GCODE_PORTS=COM3,COM5` — puertos separados por coma. `KAN_GCODE_BAUD_RATE` opcional (default 115200, el más común en Marlin/GRBL).

**`discover()` nunca escanea puertos sin configurar** — a diferencia de `plugin-esp32-arduino`, que puede escanear todos los puertos seriales porque su propio firmware responde un "ping" JSON inofensivo que cualquier otro dispositivo simplemente ignora. Acá no hay ese lujo: Marlin y GRBL no comparten un comando de identificación común, y mandarle texto G-code a un puerto serial desconocido (que podría ser cualquier otra cosa) es un riesgo real, no hipotético. Por eso `discover()` solo abre los puertos que el usuario configuró explícitamente y confirma que el puerto abre — **no** que la máquina conectada hable G-code de verdad. Si configurás mal un puerto, el error aparece recién al invocar una capability, no antes.

## Probarlo con hardware real

Esta sesión de desarrollo no tuvo una impresora 3D/CNC/láser física disponible — el driver está construido y testeado contra un firmware simulado (`FakeGcodeSerialTransport`), pero la validación con hardware real queda pendiente.

1. Conectá la máquina por USB y anotá el puerto (`COM3` en Windows, `/dev/ttyUSB0` en Linux).
2. Registrá el plugin (paso anterior) y fijá `KAN_GCODE_PORTS`.
3. Arrancá el Edge Agent (`apps/desktop`) — debería descubrir y poder conectar la máquina.
4. Clasificá los ejes (X/Y/Z) y componentes (hotend/bed) que vayas a usar en el panel **Safety Policy** de la app de escritorio.
5. Probá `get_position` desde el chat (read-only, no debería pedir confirmación) y después `move_axis` con una distancia chica (debería pedir confirmación si el eje sigue con el default `irreversible-material`).
6. Si tu máquina tiene spindle/láser, probá `start_spindle_or_laser` — **siempre** debe pedir confirmación (`safety-critical`, no bajable a un solo intento accidental) — y confirmá que `stop_spindle_or_laser`/`emergency_stop` se ejecutan sin pedir nada.
7. Verificá en `GET /v1/audit` del Gateway que las invocaciones quedaron registradas.
