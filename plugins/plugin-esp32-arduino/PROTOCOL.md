# Protocolo de cable — `plugin-esp32-arduino`

Una línea de texto por mensaje, terminada en `\n`, con un objeto JSON. Half-duplex: el driver Node nunca manda un comando nuevo sin haber recibido la respuesta del anterior (o agotado el timeout). El firmware nunca envía nada por su cuenta.

Baud rate: **115200**.

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
