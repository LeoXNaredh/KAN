# @kan/plugin-modbus

Cliente Modbus genérico — TCP y RTU serial real, mismo criterio que `@kan/plugin-gcode` cubriendo Marlin y GRBL con un solo plugin. No asume qué controla un registro. `write_register`/`write_coil` son `irreversible-material` por defecto (piden confirmación) hasta que el usuario clasifique ese `register` explícitamente en el panel **Safety Policy** — mismo mecanismo que topics MQTT o entidades de Home Assistant.

## Capabilities

- `read_registers(register, length?, unitId?)` — read-only. `register` formato `"holding:100"` o `"input:100"`.
- `read_coils(register, length?, unitId?)` — read-only. `register` formato `"coil:5"` o `"discrete:5"`.
- `write_register(register, value, unitId?)` — irreversible-material por defecto. Solo `register` de tipo `holding` (los `input` registers son de solo lectura por protocolo, FC4).
- `write_coil(register, value, unitId?)` — irreversible-material por defecto. Solo `register` de tipo `coil` (los `discrete` inputs son de solo lectura por protocolo, FC2).

`unitId` es opcional (default `1`) — soporta multi-drop: un mismo gateway TCP o una misma línea RTU puede tener varios `unitId` detrás de una sola conexión.

### Por qué el target es `"tipo:dirección"`, no solo la dirección

Un "dispositivo" es un target Modbus configurado; cada `register` invocado es un target direccionable en Safety Policy. `holding`/`input`/`coil`/`discrete` son **espacios de direcciones independientes** que pueden compartir el mismo número (holding register 100 y coil 100 no tienen relación). `SafetyPolicyStore` clasifica por `(deviceId, target)` sin conocer qué capability lo invocó — un target plano ("100") colisionaría entre esos espacios: clasificar "100" pensando en un holding register también afectaría a un input register 100 sin relación. El formato `"tipo:dirección"` evita esa ambigüedad.

Sin `listTargets()` propio — a diferencia de MQTT (que puebla targets por topics suscritos) o Home Assistant (que trae todas las entidades con `GET /api/states`), Modbus no tiene forma de enumerar qué registros existen en un dispositivo real. El usuario los conoce por la documentación de su propio PLC/gateway y los clasifica en Safety Policy a medida que los usa.

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que el resto de los plugins de hardware/red). Para habilitarlo:

```ts
import { ModbusDevicePlugin } from "@kan/plugin-modbus";

await agent.registerPlugin(new ModbusDevicePlugin());
```

## Configuración — `KAN_MODBUS_TARGETS`

`nombre|tipo|conexión` separados por coma — `tipo` es `tcp` o `rtu-serial`:

```
KAN_MODBUS_TARGETS=plc1|tcp|192.168.1.50:502
KAN_MODBUS_TARGETS=plc1|tcp|192.168.1.50:502,sensor1|rtu-serial|COM3:9600
```

`conexión` es `host:puerto` para `tcp` (502 es el puerto estándar de Modbus TCP, pero no hay default — hay que fijarlo explícitamente), o `puertoSerial:baudRate` para `rtu-serial` (baudRate opcional, default 9600, el más común en RTU). **Nunca escanea** — mismo criterio que el resto de las variables `KAN_*_TARGETS`/`_ENDPOINTS`/`_BROKERS`.

`discover()` solo abre lo que el usuario configuró y confirma que la conexión abre — no que el target hable Modbus de verdad (Modbus no tiene un comando de identificación universal, mismo caso que `plugin-gcode` con G-code). Si configurás mal un host/puerto, el error aparece recién al invocar una capability, no antes.

### Por qué no hay un tercer modo "RTU sobre TCP"

`modbus-serial` (la librería real usada acá) tiene un método `connectTcpRTUBuffered` que por el nombre sugiere mandar bytes RTU crudos (con CRC) sobre un socket TCP — la hipótesis inicial de este plugin fue tratarlo como un tercer modo de conexión distinto. Leyendo el código fuente real de la librería (`tcprtubufferedport.js`) y confirmándolo con un servidor de prueba: **arma el mismo framing MBAP que `connectTCP`** para lo que sale por la red — solo reconstruye un CRC sintético del lado del cliente para reusar internamente el mismo parser que RTU serial. Un servidor Modbus TCP real no distingue una conexión de la otra. Por eso este plugin solo tiene `tcp` (para cualquier target que hable Modbus TCP estándar, incluida la enorme mayoría de gateways comerciales serial-a-Ethernet) y `rtu-serial` (para un puerto serial/RS-485 real). Un gateway que haga un túnel de bytes RTU crudos de verdad (no traducción de protocolo — un producto distinto, menos común) no está cubierto todavía.

## Probarlo de verdad

1. Fijá `KAN_MODBUS_TARGETS` con un PLC/gateway Modbus TCP real y accesible, o un dispositivo RTU por USB-RS485.
2. Registrá el plugin (paso anterior) y arrancá el Edge Agent — debería descubrir el target.
3. Desde el chat, pedí `read_registers` con un `register` que exista según la documentación de tu dispositivo (ej. `"holding:0"`).
4. Probá `write_register` — debería pedir confirmación en la app de escritorio (ADR-004), no ejecutarse solo.
5. Clasificá ese `register` en Safety Policy si querés cambiar su severidad por defecto.
6. Verificá en `GET /v1/audit` del Gateway que la invocación quedó registrada.

Esta sesión de desarrollo no tuvo un PLC/dispositivo Modbus físico disponible — el driver está construido y testeado contra `ServerTCP` real (Modbus TCP, `modbus-serial`) y `FakeModbusTransport` (unitario), pero la validación con hardware real (especialmente RTU serial/RS-485) queda pendiente.
