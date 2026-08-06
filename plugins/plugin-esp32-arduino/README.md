# @kan/plugin-esp32-arduino

Primer driver de hardware físico real de KAN: GPIO genérico de un ESP32 o Arduino sobre Serial/USB. Mismo `DeviceDriverPort` que `@kan/plugin-device-simulator` — nada en el Edge Agent, el Gateway o el chat necesita saber que este dispositivo es real y no simulado.

No asume qué hay conectado a un pin. La severidad de una escritura es `irreversible-material` por defecto (pide confirmación) hasta que el usuario clasifique ese pin explícitamente en el panel **Safety Policy** de la app de escritorio (`@kan/edge-agent-core`, `SafetyPolicyStore`).

## Capabilities

- `read_digital_pin(pin)` — read-only
- `read_analog_pin(pin)` — read-only
- `write_digital_pin(pin, value: boolean)` — irreversible-material por defecto
- `write_analog_pin(pin, value: 0-255)` — irreversible-material por defecto

Protocolo de cable completo en [`PROTOCOL.md`](./PROTOCOL.md).

## Uso

No se registra automáticamente en `apps/desktop` (a diferencia del simulador) para no forzar la dependencia nativa `serialport` en quien solo quiera usar el simulador. Para habilitarlo, en `apps/desktop/src/main/index.ts`:

```ts
import { Esp32ArduinoPlugin } from "@kan/plugin-esp32-arduino";

await agent.registerPlugin(new Esp32ArduinoPlugin());
```

## Probarlo con hardware real

Esta sesión de desarrollo no tuvo un ESP32/Arduino físico disponible — el driver está construido y testeado contra un transporte serial simulado (`FakeSerialTransport`), pero la validación con hardware real queda pendiente. Pasos para cuando tengas la placa a mano:

1. **Flashear el firmware.** Abre `firmware/kan_esp32_bridge/kan_esp32_bridge.ino` en el Arduino IDE (o `arduino-cli`), selecciona tu placa y puerto, y súbelo. Ver instrucciones en la cabecera del archivo.
2. **Conectar la placa** por USB. Anota el puerto que le asigna el sistema operativo (ej. `COM3` en Windows, `/dev/ttyUSB0` en Linux).
3. **Arrancar el Edge Agent** (`apps/desktop`) con el plugin registrado (paso anterior). Por defecto intenta descubrir el puerto automáticamente probando cada puerto serial disponible con un `ping`; si prefieres saltarte el escaneo, fija la variable de entorno `KAN_ESP32_PORT` (ej. `KAN_ESP32_PORT=COM3`) antes de arrancar.
4. **Clasificar tus pines.** En la app de escritorio, en la tarjeta del dispositivo ESP32/Arduino recién descubierto, abre el panel **Safety Policy** y asígnale un alias y severidad a cada pin que vayas a usar (ej. GPIO 2 → "LED interno" → `reversible`; GPIO 5 → "Relé bomba de agua" → deja `irreversible-material`). Los pines que no toques se quedan con el default restrictivo.
5. **Probar desde el chat.** Pide algo como "enciende el LED del pin 2" — si el pin 2 quedó clasificado como `reversible`, se ejecuta directo; si no, la respuesta debe indicar que se requiere confirmación en la app de escritorio (no se ejecuta sola).
6. Verifica en `GET /v1/audit` del Gateway que tanto la invocación como cualquier cambio de Safety Policy quedaron registrados.

Si algo no calza exactamente con tu placa (nombres de pines distintos, un tipo de ESP32/Arduino distinto al DevKit estándar asumido en `src/pinMap.ts`), ese mapa de pines es el primer lugar a ajustar.
