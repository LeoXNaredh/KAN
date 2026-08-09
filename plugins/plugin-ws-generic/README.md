# @kan/plugin-ws-generic

Cliente WebSocket genérico: manda y recibe mensajes por un WS que el usuario ya haya configurado explícitamente — nunca uno que la IA o el usuario elijan libremente en la conversación (misma defensa contra SSRF que `@kan/plugin-http-generic`).

No asume qué provoca un mensaje del otro lado. `send_ws_message` es `irreversible-material` por defecto (pide confirmación) hasta que el usuario lo reclasifique en el panel **Safety Policy** de la app de escritorio.

## Capabilities

- `send_ws_message(payload)` — irreversible-material por defecto.
- `read_ws_messages()` — read-only. Devuelve hasta los últimos 50 mensajes recibidos (buffer en memoria, se descarta el más viejo al superar el límite).

Un "dispositivo" es una conexión WS configurada. A diferencia de MQTT (que tiene topics) o HTTP genérico (que tiene paths), acá no hay sub-canales — el canal es el dispositivo entero, así que ninguna capability tiene `targetParam`.

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que el resto de los plugins de hardware/red). Para habilitarlo:

```ts
import { WsDevicePlugin } from "@kan/plugin-ws-generic";

await agent.registerPlugin(new WsDevicePlugin());
```

## Configuración — `KAN_WS_ENDPOINTS`

`nombre|wsUrl|Header:valor` separados por coma, el header es opcional:

```
KAN_WS_ENDPOINTS=eco|wss://echo.example.com
KAN_WS_ENDPOINTS=eco|wss://echo.example.com|Authorization:Bearer xyz,sensores|ws://192.168.1.20:8080
```

**Nunca escanea** — mismo criterio que `KAN_HTTP_ENDPOINTS`/`KAN_MQTT_BROKERS`/`KAN_ESP32_WIFI_HOSTS`: el host lo fija esta variable, no la conversación. **Limitación conocida** (igual que las otras variables `KAN_*` con formato `|`/coma): un valor de header con coma o pipe rompe el parseo.

`discover()` conecta y cierra enseguida para confirmar que hay un servidor WS real ahí (mismo criterio que `plugin-mqtt` con el CONNACK real).

## Sin reconexión automática — a propósito

A diferencia de `plugin-mqtt` (que se apoya en la reconexión nativa de `mqtt.js`, ADR-022), este plugin **no reintenta solo** si la conexión se corta — queda `disconnected` hasta que algo llame a `connect()` de nuevo. Es una simplificación deliberada para un primer corte de un plugin genérico: un WebSocket arbitrario no tiene un contrato de reconexión estándar como MQTT (resubscribe automático, etc.), así que implementar backoff genérico acá sin un caso real que lo pida sería construir para una necesidad hipotética. Si se vuelve un problema real, el patrón de `NodeTcpTransport` (backoff exponencial) es el precedente a seguir.

## Fuera de alcance, a propósito

- Nada de elegir una URL en tiempo real desde el chat — si no está en `KAN_WS_ENDPOINTS`, no existe como dispositivo.
- Sin binario/protobuf — solo mensajes de texto.
- Sin reconexión automática (ver arriba).

## Probarlo de verdad

1. Fijá `KAN_WS_ENDPOINTS` con un WS real y accesible (puede ser algo tan simple como `wss://ws.postman-echo.com/raw`).
2. Registrá el plugin (paso anterior) y arrancá el Edge Agent — debería descubrir el endpoint.
3. Desde el chat, pedí `send_ws_message` con un texto cualquiera — debería pedir confirmación en la app de escritorio (ADR-004), no ejecutarse solo.
4. Pedí `read_ws_messages` — debería mostrar la respuesta del eco.
5. Verificá en `GET /v1/audit` del Gateway que la invocación quedó registrada.
