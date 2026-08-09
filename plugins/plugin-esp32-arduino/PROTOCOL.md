# Protocolo de cable — `plugin-esp32-arduino`

Una línea de texto por mensaje, terminada en `\n`, con un objeto JSON. Half-duplex: el driver Node nunca manda un comando nuevo sin haber recibido la respuesta del anterior (o agotado el timeout). El firmware nunca envía nada por su cuenta.

El protocolo es el mismo sin importar el transporte:

- **Serial** — 115200 baud (`kan_esp32_bridge.ino`).
- **WiFi (TCP)** — puerto 8266 por defecto (`kan_esp32_bridge_wifi.ino`). El driver Node reconecta solo ante una caída transitoria (backoff exponencial, hasta 5 intentos) — ver `LineConnection`/`NodeTcpTransport` en `src/`.

## Comandos (Node → dispositivo)

| Comando | Payload | Descripción |
|---|---|---|
| `ping` | `{"cmd":"ping"}` | Handshake de descubrimiento. |
| `read_digital` | `{"cmd":"read_digital","pin":<int>}` | Lee `digitalRead(pin)`. |
| `read_analog` | `{"cmd":"read_analog","pin":<int>}` | Lee `analogRead(pin)`. |
| `write_digital` | `{"cmd":"write_digital","pin":<int>,"value":<bool>}` | `digitalWrite(pin, value ? HIGH : LOW)`. |
| `write_analog` | `{"cmd":"write_analog","pin":<int>,"value":<0-255>}` | `analogWrite(pin, value)` / `ledcWrite` según el pin. |

## Respuestas (dispositivo → Node)

Éxito: `{"ok":true, ...datos}`. Ejemplos:

- `ping` → `{"ok":true,"device":"kan-esp32"}`
- `read_digital` → `{"ok":true,"value":0}` o `{"ok":true,"value":1}`
- `read_analog` → `{"ok":true,"value":2731}`
- `write_digital` / `write_analog` → `{"ok":true}`

Error: `{"ok":false,"error":"<mensaje>"}`.

## Qué NO valida el firmware

El firmware es un puente "tonto": ejecuta lo que se le pide, sin decidir si es seguro. Toda la seguridad (severidad por defecto de cada capability, Safety Policy por pin, confirmación explícita del usuario) vive del lado de Node (`@kan/edge-agent-core`) — el firmware no tiene forma de saber qué hay físicamente conectado a un pin, así que no debe intentar decidirlo.

## Seguridad (pendiente)

**Estado actual del transporte WiFi: sin autenticación.** Cualquier dispositivo en la misma red que sepa `IP:puerto` puede conectarse por TCP y mandar comandos — incluyendo escrituras a un pin conectado a una máquina física real (ej. mover un láser, activar un relé). Esto es aceptable únicamente en una red doméstica de confianza total; **no exponer este puerto a una red no confiable ni a internet**.

El transporte Serial no tiene este problema — requiere acceso físico al puerto USB.

**Diseño planeado (no implementado todavía):**

1. Al conectar, antes de aceptar cualquier otro comando, el cliente (Node) manda `{"cmd":"auth","token":"<token>"}`.
2. El firmware compara el token contra uno configurado de antemano (ej. quemado en el sketch al flashear, o guardado en NVS). Si coincide: `{"ok":true}` y la conexión queda habilitada para el resto de los comandos. Si no coincide, o el primer comando no es `auth`: `{"ok":false,"error":"no autorizado"}` y el firmware cierra la conexión.
3. `NetworkTransportPort.open()` ya acepta un `options.token` para esto (`TransportOptions`, movido a `@kan/serial-line-transport` — ver `packages/serial-line-transport/src/NetworkTransportPort.ts`) — hoy no se usa, es el punto de enganche cuando esto se implemente. Ver el `TODO(seguridad)` en `packages/serial-line-transport/src/infra/NodeTcpTransport.ts`.

Bloqueante recomendado antes de usar el transporte WiFi contra cualquier dispositivo con capacidad de causar daño físico real (motores, relés de potencia, láseres) fuera de un banco de pruebas controlado.
