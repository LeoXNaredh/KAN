# @kan/plugin-network-tools

Dos utilidades de red livianas en un solo plugin (mismo criterio que `plugin-gcode` combinando Marlin/GRBL): **Wake-on-LAN** y **SNMP** (monitoreo, solo lectura). Ninguna trae binding nativo — WoL está implementado a mano sobre `dgram` (el magic packet es trivial y estable, no vale la pena una dependencia externa para 15 líneas), SNMP usa el paquete `net-snmp`.

## Wake-on-LAN

- `wake_on_lan()` — irreversible-material por defecto (despertar una máquina es una acción real, aunque no destructiva). Sin parámetros: la MAC/broadcast/puerto ya están fijados por config, no por input — un dispositivo = un magic packet configurado.

Un "dispositivo" WoL es un target configurado (nombre + MAC + broadcast/puerto opcionales). `discover()` siempre reporta los targets configurados sin verificar nada — WoL es fire-and-forget UDP, no hay ninguna forma de confirmar de antemano si la máquina existe o está apagada/despierta.

## SNMP

- `snmp_get(oid)` — read-only.
- `snmp_walk(oid)` — read-only, recorre el subárbol MIB a partir del OID dado.

Deliberadamente **sin `snmp_set`** — el alcance de este incremento es monitoreo, no reconfiguración remota de equipos de red (un SET mal dado puede dejar un switch/router inoperable). Si hace falta más adelante, es una capability nueva con su propia severidad (`safety-critical`, probablemente), no una extensión de `snmp_get`.

Un "dispositivo" SNMP es un agente configurado (host:puerto + community). Cada `oid` es un target direccionable en Safety Policy — aunque acá las dos capabilities son read-only por defecto, así que el override solo importaría si alguien quisiera exigir confirmación para leer un OID específico.

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que el resto de los plugins de hardware/red). Para habilitarlo:

```ts
import { NetworkToolsDevicePlugin } from "@kan/plugin-network-tools";

await agent.registerPlugin(new NetworkToolsDevicePlugin());
```

## Configuración

### `KAN_WOL_TARGETS`

`nombre|macAddress|broadcastIp:puerto` separados por coma — `broadcastIp:puerto` opcional (default `255.255.255.255:9`):

```
KAN_WOL_TARGETS=server1|AA:BB:CC:DD:EE:FF
KAN_WOL_TARGETS=server1|AA:BB:CC:DD:EE:FF|192.168.1.255:9,nas|11:22:33:44:55:66
```

### `KAN_SNMP_TARGETS`

`nombre|host:puerto|community` separados por coma — puerto y community opcionales (default `161`/`public`):

```
KAN_SNMP_TARGETS=switch1|192.168.1.1
KAN_SNMP_TARGETS=switch1|192.168.1.1:161|public,router1|192.168.1.254:161|privado
```

**Nunca escanea** — mismo criterio que el resto de las variables `KAN_*_TARGETS`. Para WoL la razón no es tanto SSRF (una MAC inexistente simplemente no hace nada) sino evitar que la IA elija libremente qué máquina despertar. `discover()` sí valida los targets SNMP con un `get` real a `sysDescr.0` (universal en cualquier agente SNMP compliant) antes de reportarlos — mismo criterio que HTTP genérico/Home Assistant.

## Probarlo de verdad

**Wake-on-LAN:** fijá `KAN_WOL_TARGETS` con la MAC real de una máquina en tu red con WoL habilitado en la BIOS/firmware, registrá el plugin y pedí `wake_on_lan` desde el chat — debería pedir confirmación (ADR-004) antes de mandar el magic packet.

**SNMP:** fijá `KAN_SNMP_TARGETS` con un switch/router/impresora que tenga SNMP habilitado (community `public` es el default de fábrica en muchos equipos, cambialo si es tu red real), y pedí `snmp_get`/`snmp_walk` desde el chat.

En ambos casos, verificá en `GET /v1/audit` del Gateway que la invocación quedó registrada.
