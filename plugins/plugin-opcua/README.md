# @kan/plugin-opcua

Cliente OPC-UA — el protocolo industrial más moderno del mapa (frente a Modbus, que es de los 70). Cliente de un endpoint ya configurado, nunca uno elegido en la conversación — misma defensa contra SSRF que el resto de los plugins de red.

No asume qué controla un nodo. `write_node` es `irreversible-material` por defecto (pide confirmación) hasta que el usuario clasifique ese `nodeId` explícitamente en el panel **Safety Policy** — mismo mecanismo que registros Modbus o entidades de Home Assistant.

## Capabilities

- `read_node(nodeId)` — read-only. Ej.: `{nodeId: "ns=1;s=Temperatura"}`.
- `write_node(nodeId, value, dataType)` — irreversible-material por defecto. `dataType` es uno de: `Double`, `Float`, `Int32`, `UInt32`, `Boolean`, `String`.
- `browse_node(nodeId?)` — read-only. Lista los nodos hijos de un nodo (por defecto, `RootFolder`).

### Por qué `write_node` es `irreversible-material`, no `safety-critical`

A diferencia de `plugin-ssh` (donde un comando puede hacer cualquier cosa en el sistema operativo), OPC-UA escribe un tag/variable puntual y acotado del servidor industrial — mismo nivel de riesgo que `write_register` de `plugin-modbus`, no el techo del sistema.

Un "dispositivo" es un endpoint OPC-UA configurado; cada `nodeId` (ej. `"ns=1;s=Temperatura"`) es un target direccionable en Safety Policy.

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que el resto de los plugins de hardware/red). Para habilitarlo:

```ts
import { OpcuaDevicePlugin } from "@kan/plugin-opcua";

await agent.registerPlugin(new OpcuaDevicePlugin());
```

## Configuración — `KAN_OPCUA_TARGETS`

`nombre|endpointUrl|usuario|contraseña` separados por coma — usuario/contraseña opcional (anónimo si se omite):

```
KAN_OPCUA_TARGETS=plc1|opc.tcp://192.168.1.50:4840
KAN_OPCUA_TARGETS=plc1|opc.tcp://192.168.1.50:4840|admin|contraseña-real
```

**Nunca escanea** — mismo criterio que el resto de las variables `KAN_*_TARGETS`. `discover()` sí abre una sesión real contra cada endpoint para confirmar que responde antes de reportarlo (mismo criterio que HTTP genérico/Home Assistant/Modbus).

## Hallazgos reales durante la implementación (documentación de `node-opcua` incorrecta en dos puntos)

Verificado en vivo, de punta a punta, contra un `OPCUAServer` real (no un mock) — y en el camino, la documentación oficial de la librería resultó equivocada dos veces, ambas detectadas solo por probarlas:

1. **El ejemplo JSDoc de la propia clase `OPCUAServer`** usa `componentOf: addressSpace.rootFolder.objects` para agregar una variable al folder estándar "Objects" — el código real tiene un `assert` explícito que **prohíbe** exactamente eso ("Only Organizes References are used to relate Objects to the 'Objects' standard Object"). El fix real es `organizedBy`, no `componentOf`.
2. **`session.read()` nunca rechaza a nivel de transporte** para un `nodeId` inválido/inexistente — siempre "resuelve" con un `DataValue` cuyo `statusCode` indica el error (ej. `BadNodeIdUnknown`). Sin chequear `dataValue.statusCode.isGood()` explícitamente, un `nodeId` con un typo se leería en silencio como `{value: null}` en vez de fallar con un error claro — corregido en `NodeOpcuaTransport.readNode()`.

Además: los `browseName` de nodos en un namespace distinto de 0 (que es el caso normal para cualquier variable de usuario, vía `getOwnNamespace()`) se representan con el prefijo del índice de namespace, ej. `"1:Temperatura"`, no `"Temperatura"` pelado — comportamiento correcto de la librería, no un bug, pero fácil de asumir mal sin probarlo contra un servidor real.

## Probarlo de verdad

1. Fijá `KAN_OPCUA_TARGETS` con un servidor/PLC OPC-UA real y accesible.
2. Registrá el plugin (paso anterior) y arrancá el Edge Agent — debería descubrir el endpoint.
3. Desde el chat, pedí `browse_node` para ver qué nodos existen, después `read_node` sobre uno real.
4. Pedí `write_node` — debería pedir confirmación en la app de escritorio (ADR-004), no ejecutarse solo.
5. Verificá en `GET /v1/audit` del Gateway que la invocación quedó registrada.

Esta sesión de desarrollo no tuvo un PLC/servidor OPC-UA físico disponible — el driver está construido y testeado contra un `OPCUAServer` real embebido (`node-opcua`, con una variable escribible vía `bindVariable`) y `FakeOpcuaTransport` (unitario), pero la validación con hardware industrial real queda pendiente.
