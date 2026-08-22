# @kan/plugin-esp32-arduino

Primer driver de hardware físico real de KAN: GPIO genérico de un ESP32 o Arduino sobre Serial/USB **o WiFi**. Mismo `DeviceDriverPort` que `@kan/plugin-device-simulator` — nada en el Edge Agent, el Gateway o el chat necesita saber que este dispositivo es real y no simulado, ni por qué transporte está conectado.

No asume qué hay conectado a un pin. La severidad de una escritura es `irreversible-material` por defecto (pide confirmación) hasta que el usuario clasifique ese pin explícitamente en el panel **Safety Policy** de la app de escritorio (`@kan/edge-agent-core`, `SafetyPolicyStore`).

## Capabilities

- `read_digital_pin(pin)` — read-only
- `read_analog_pin(pin)` — read-only
- `write_digital_pin(pin, value: boolean)` — irreversible-material por defecto
- `write_analog_pin(pin, value: 0-255)` — irreversible-material por defecto

Protocolo de cable completo en [`PROTOCOL.md`](./PROTOCOL.md).

## Backup/restore de proyecto (docs/06, Plataforma B)

Solo disponible si se construye el plugin con un `snapshotTransport` (3er
argumento del constructor) — sin él, el plugin sigue siendo GPIO-only, sin
ningún cambio de comportamiento (compatibilidad hacia atrás a propósito).

- `project_list_files` / `project_read_file` / `project_save_snapshot` /
  `project_restore_snapshot` — las 4 capabilities estándar
  (`@kan/plugin-sdk-ts`).
- `compile_and_upload(fqbn?)` — irreversible-material. Compila con
  `arduino-cli` el sketch guardado y lo sube al chip.

**Nivel 1 (código fuente, `.ino`)**: no hay forma de leer código de vuelta
desde el chip (a diferencia de MicroPython) — `SketchStore` guarda
localmente en el Edge Agent lo último que se restauró/escribió. Cualquier
archivo que termine en `.ino` se renombra automáticamente a
`<deviceId>.ino` al guardarlo (arduino-cli exige que el `.ino` principal
tenga el mismo nombre que su carpeta).

**Nivel 2 (binario, dump de flash)**: pedí explícitamente
`project_save_snapshot({ backupType: "binary" })` — por defecto
(`getBackupType()`) este driver usa `"source"`; el override es por request,
no una config fija (`plugin-sdk-ts`, `handleProjectCapability`). Lee/escribe
el flash completo con `esptool.py` (ESP32, default) o `avrdude` (Arduino AVR
clásico — Uno/Nano/Mega), configurable por variable de entorno:

| Variable | Default | Para qué |
|---|---|---|
| `KAN_ESP32_FLASH_TOOL` | `esptool` | `esptool` o `avrdude` |
| `KAN_ESP32_ESPTOOL_CHIP` | `esp32` | `--chip` de esptool (ej. `esp32s3`) |
| `KAN_ESP32_FLASH_SIZE_BYTES` | `4194304` (4 MiB) | cuánto leer con `read_flash` |
| `KAN_ESP32_AVRDUDE_PROGRAMMER` | `arduino` | `-c` de avrdude |
| `KAN_ESP32_AVRDUDE_PART` | `atmega328p` | `-p` de avrdude |
| `KAN_ESP32_AVRDUDE_BAUD` | `115200` | `-b` de avrdude |
| `KAN_ESP32_FQBN` | (ninguno) | Fully Qualified Board Name para `compile_and_upload` si no se pasa `fqbn` en el input |

`arduino-cli`/`esptool.py`/`avrdude` son **requisitos opcionales, nunca
instalados automáticamente por KAN** — sin ellos instalados/en el `PATH`,
`compile_and_upload`/el nivel binario devuelven un error claro
("¿está instalado y en el PATH?"); el resto del plugin (GPIO, nivel 1)
sigue funcionando igual. Instalación:
[arduino-cli](https://arduino.github.io/arduino-cli/latest/installation/),
[esptool](https://docs.espressif.com/projects/esptool/en/latest/esp32/) (`pip install esptool`),
[avrdude](https://github.com/avrdude/avrdude).

**Backup de un board sin firmware KAN**: el escaneo automático (`discover()`
sin `KAN_ESP32_PORT`) sigue exigiendo el ping del firmware bridge, sin
cambios — nunca reclama un puerto ajeno. Pero fijando `KAN_ESP32_PORT` a
mano (con un `snapshotTransport` configurado), el plugin registra igual un
board que NO responde el bridge — es el caso real de uso: un Arduino
corriendo el sketch propio del usuario, no el firmware de KAN. Ese
dispositivo aparece sin las 4 capabilities de GPIO (no hay wire protocol que
hablar), solo con `project_*`/`compile_and_upload`.

`arduino-cli`/`esptool`/`avrdude` necesitan acceso exclusivo al puerto
serial — si KAN lo tenía abierto (bridge conectado), se suelta antes de
invocar la herramienta externa y se reabre después automáticamente.

## Uso

Se registra en `apps/desktop/src/main/index.ts` con import dinámico + try/catch (mismo criterio que `@kan/plugin-raspberry-pi`) — un fallo de carga no debe tumbar el resto del Edge Agent para quien no tiene un ESP32/Arduino conectado.

## Estado bajo Electron (`apps/desktop`) — binding nativo sin cargar todavía

`serialport` trae un binding nativo (`.node`) que carga bien bajo el Node del sistema (por eso los tests de este plugin siempre pasan), pero **no bajo el ABI de Node que usa Electron** — confirmado en vivo, no hipotético:

```
Error: No native build was found for platform=win32 arch=x64 runtime=electron abi=130 uv=1 libc=glibc node=20.18.3 electron=33.4.11
```

Se agregó `@electron/rebuild` como devDependency de `apps/desktop` con un script manual — `pnpm --filter desktop rebuild:native` — para quien tenga instalado Visual Studio Build Tools ("Desktop development with C++") y quiera intentar recompilar `serialport` para el ABI de Electron. En esta máquina de desarrollo ese workload no está instalado, y el intento falló con el mismo bloqueo exacto que `@abandonware/noble` en `plugin-bluetooth-generic` (ver ese README):

```
gyp ERR! find VS You need to install the latest version of Visual Studio
gyp ERR! find VS including the "Desktop development with C++" workload.
```

**Deliberadamente no es un `postinstall` automático** — se probó primero como `postinstall`, y un rebuild que falla por Visual Studio ausente rompe `pnpm install` para **todo el monorepo**, no solo este plugin (afecta a cualquier máquina o CI sin ese toolchain). Se revirtió a script manual apenas se confirmó el efecto. Mientras tanto, el plugin se registra igual y no rompe nada — el try/catch de `apps/desktop` lo captura y loguea un warning; sin ESP32 conectado, el resto del Edge Agent (simulador incluido) sigue funcionando normal.

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
