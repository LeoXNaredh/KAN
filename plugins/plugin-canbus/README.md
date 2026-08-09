# @kan/plugin-canbus

CAN Bus — vehículos (OBD-II, ECUs) e industrial (CANopen, automatización) — vía adaptadores USB-CAN baratos (CANable, CANtact, USBtin, CANUSB) que hablan el protocolo **SLCAN/Lawicel**: texto ASCII sobre un puerto serial estándar. El adaptador se enumera como un puerto COM/tty normal — **sin ninguna librería de CAN Bus ni binding nativo**. Reusa `@kan/serial-line-transport` (el mismo transporte real que ya usan `plugin-esp32-arduino`/`plugin-gcode`/`plugin-serial-generic`), extendido con un delimitador de línea configurable (`\r`, no `\n` — ver ADR-052).

## Por qué SLCAN y no una librería de CAN Bus

Investigado explícitamente antes de implementar (condición del usuario: "solo si hay librería sin binding nativo problemático"):

- **SocketCAN** — la API nativa de Linux para CAN, no existe en Windows.
- **`cs-pcan-usb`** (hardware PEAK PCAN) y equivalentes — requieren un binding N-API nativo específico por vendor, el mismo riesgo que ya se evitó con `@abandonware/noble`/`epoll` en sesiones anteriores.
- **SLCAN** — protocolo de texto abierto, sin binding nativo de ningún tipo: el adaptador aparece como puerto serial y este plugin arma/parsea el framing (`SlcanCodec.ts`) igual que `plugin-serial-generic` arma/parsea líneas de texto. Es el estándar de facto para CANable y la mayoría de adaptadores USB-CAN económicos.

Ver ADR-052 para el detalle completo de la decisión.

## Capabilities

- `send_frame(canId, data, extended?)` — **irreversible-material** por defecto (pide confirmación). `targetParam: "canId"` — la Safety Policy puede reclasificar la severidad por ID de trama individual (ej. tramas de diagnóstico de solo lectura vs. tramas de control de un actuador).
- `read_last_frames()` — read-only. Devuelve hasta las últimas 50 tramas recibidas del bus (buffer en memoria).

Un "dispositivo" es un canal CAN configurado (un adaptador conectado a un puerto). Sin sub-targets a nivel dispositivo — `canId` es el target a nivel de la capability `send_frame`, no del dispositivo (mismo patrón que Modbus con sus registros).

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que el resto de los plugins de hardware). Para habilitarlo:

```ts
import { CanbusDevicePlugin } from "@kan/plugin-canbus";

await agent.registerPlugin(new CanbusDevicePlugin());
```

## Configuración — `KAN_CANBUS_TARGETS`

`nombre|puerto|bitrate` separados por coma — bitrate opcional en bit/s (default `500000`, el más común en CAN automotriz/industrial — OBD-II y CANopen suelen usarlo). Solo se aceptan los bitrates que SLCAN soporta (`SLCAN_BITRATE_TO_CODE` en `SlcanCodec.ts`: 10000, 20000, 50000, 100000, 125000, 250000, 500000, 750000, 1000000, 83300) — un valor fuera de esa tabla descarta el target silenciosamente en `discover()`, igual que un puerto inalcanzable:

```
KAN_CANBUS_TARGETS=obd|COM3
KAN_CANBUS_TARGETS=obd|COM3|500000,plc_industrial|COM4|250000
```

**Nunca escanea** — mandar tramas a un bus CAN desconocido puede accionar hardware real (frenos, actuadores industriales, ECUs). `discover()` abre el canal (handshake SLCAN completo: fija el bitrate y abre el canal) y lo vuelve a cerrar — confirma que el adaptador responde, no que haya un bus real con nodos del otro lado.

## Handshake SLCAN — qué hace y qué no

Al conectar: manda `S<n>` (fija el bitrate — el canal debe estar cerrado) y después `O` (abre el canal). **No** manda `C` (cerrar canal) al arrancar: la mayoría de firmwares SLCAN arrancan con el canal ya cerrado, y la señalización de error de un `C` sobre un canal ya cerrado (algunos firmwares mandan BEL sin CR de vuelta) es ambigua de distinguir de forma genérica con un parser de líneas basado en `\r` — si un adaptador queda con el canal abierto de una sesión anterior sin cerrar limpio, el `S<n>` puede fallar. Limitación conocida, no oculta — mismo criterio que la verificación de host key no implementada en `plugin-ssh`.

## Sin hardware físico probado en esta sesión

No hubo un adaptador USB-CAN real disponible en este entorno de desarrollo — mismo caso ya documentado para RTU serial en `plugin-modbus` y para el puerto serial genérico en `plugin-serial-generic`. Lo que sí se probó de punta a punta:

- **`SlcanCodec.ts`** (encode/decode de tramas, tabla de bitrates) — funciones puras, verificadas byte a byte contra el formato real de `python-can` (`can/interfaces/slcan.py`, leído directamente, no su documentación — que no detalla el formato).
- **`SlcanTransport.ts`** (el handshake real: orden de comandos, delimitador `\r`, timeout si el adaptador no responde, envío/recepción de tramas) — probado contra un doble a nivel de puerto serial que simula un adaptador SLCAN respondiendo, ejerciendo la lógica real del transporte (no una sustitución de esa lógica).
- **`NodeSerialTransport`** (`@kan/serial-line-transport`) — el nuevo parámetro `delimiter` se probó con la clase real `ReadlineParser` de `serialport` (sin necesitar hardware ni mockear el binding nativo), más un sanity check de "sin hardware conectado" ya establecido para el resto de los plugins seriales.

## Probarlo de verdad

1. Conectá un adaptador USB-CAN compatible con SLCAN (ej. CANable con firmware `candlelight` o `slcan`) y anotá su puerto.
2. Fijá `KAN_CANBUS_TARGETS` con ese puerto y el bitrate del bus al que te vas a conectar.
3. Registrá el plugin (paso anterior) y arrancá el Edge Agent — debería descubrir el canal.
4. Desde el chat, pedí `read_last_frames` para ver qué tráfico hay en el bus (si el adaptador está en un bus real activo).
5. Pedí `send_frame` con un `canId`/`data` — debería pedir confirmación en la app de escritorio (ADR-004), no ejecutarse solo.
6. Verificá en `GET /v1/audit` del Gateway que la invocación quedó registrada.
