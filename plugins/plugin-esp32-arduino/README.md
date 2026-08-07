# @kan/plugin-esp32-arduino

Primer driver de hardware físico real de KAN: GPIO genérico de un ESP32 o Arduino sobre Serial/USB **o WiFi**. Mismo `DeviceDriverPort` que `@kan/plugin-device-simulator` — nada en el Edge Agent, el Gateway o el chat necesita saber que este dispositivo es real y no simulado, ni por qué transporte está conectado.

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

1. **Flashear el firmware.** Para Serial: `firmware/kan_esp32_bridge/kan_esp32_bridge.ino`. Para WiFi (solo placas ESP32): `firmware/kan_esp32_bridge_wifi/kan_esp32_bridge_wifi.ino` — completá `WIFI_SSID`/`WIFI_PASSWORD` antes de subirlo, y **leé la sección "Seguridad (pendiente)" de [`PROTOCOL.md`](./PROTOCOL.md) antes de usarlo** (el transporte WiFi todavía no tiene autenticación). Abrí cualquiera de los dos en el Arduino IDE (o `arduino-cli`), seleccioná tu placa y puerto, y subilo — instrucciones completas en la cabecera de cada archivo.
2. **Conectar la placa.** Por USB: anotá el puerto que le asigna el sistema operativo (ej. `COM3` en Windows, `/dev/ttyUSB0` en Linux). Por WiFi: abrí el Monitor Serial una vez para ver la IP que le asignó tu router.
3. **Arrancar el Edge Agent** (`apps/desktop`) con el plugin registrado (paso anterior).
   - Serial: por defecto intenta descubrir el puerto automáticamente probando cada puerto serial disponible con un `ping`; si preferís saltarte el escaneo, fijá `KAN_ESP32_PORT` (ej. `KAN_ESP32_PORT=COM3`).
   - WiFi: nunca escanea la red — fijá `KAN_ESP32_WIFI_HOSTS` con la IP (y opcionalmente el puerto, por defecto 8266) del/los dispositivo(s), ej. `KAN_ESP32_WIFI_HOSTS=192.168.1.50` o `192.168.1.50:8266,192.168.1.51`. Si la conexión se cae, el driver reintenta solo (backoff exponencial, hasta 5 intentos) antes de marcarlo como desconectado.
4. **Clasificar tus pines.** En la app de escritorio, en la tarjeta del dispositivo ESP32/Arduino recién descubierto, abre el panel **Safety Policy** y asígnale un alias y severidad a cada pin que vayas a usar (ej. GPIO 2 → "LED interno" → `reversible`; GPIO 5 → "Relé bomba de agua" → deja `irreversible-material`). Los pines que no toques se quedan con el default restrictivo.
5. **Probar desde el chat.** Pide algo como "enciende el LED del pin 2" — si el pin 2 quedó clasificado como `reversible`, se ejecuta directo; si no, la respuesta debe indicar que se requiere confirmación en la app de escritorio (no se ejecuta sola).
6. Verifica en `GET /v1/audit` del Gateway que tanto la invocación como cualquier cambio de Safety Policy quedaron registrados.

Si algo no calza exactamente con tu placa (nombres de pines distintos, un tipo de ESP32/Arduino distinto al DevKit estándar asumido en `src/pinMap.ts`), ese mapa de pines es el primer lugar a ajustar.
