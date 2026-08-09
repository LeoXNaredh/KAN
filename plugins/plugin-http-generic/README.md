# @kan/plugin-http-generic

Cliente HTTP/REST genérico: llama a cualquier API REST que el usuario ya haya configurado explícitamente — nunca una que la IA o el usuario elijan libremente en la conversación (esa es la única defensa real contra SSRF, ver "Configuración" abajo).

No asume qué hace un endpoint. `http_post`/`http_put`/`http_patch`/`http_delete` son `irreversible-material` por defecto (piden confirmación) hasta que el usuario clasifique ese `path` explícitamente en el panel **Safety Policy** — mismo mecanismo que topics MQTT (`@kan/plugin-mqtt`) o pines ESP32 (`@kan/plugin-esp32-arduino`), sin tocar esa infraestructura.

## Capabilities

- `http_get(path, query?)` — read-only.
- `http_post(path, body?)` — irreversible-material por defecto.
- `http_put(path, body?)` — irreversible-material por defecto.
- `http_patch(path, body?)` — irreversible-material por defecto.
- `http_delete(path)` — irreversible-material por defecto.

Un "dispositivo" es un endpoint base configurado (no una request individual) — cada `path` que invocás se vuelve un target direccionable en Safety Policy, igual que un topic MQTT.

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que el resto de los plugins de hardware/red). Para habilitarlo:

```ts
import { HttpDevicePlugin } from "@kan/plugin-http-generic";

await agent.registerPlugin(new HttpDevicePlugin());
```

## Configuración — `KAN_HTTP_ENDPOINTS`

`nombre|baseUrl|Header:valor` separados por coma, el header es opcional:

```
KAN_HTTP_ENDPOINTS=clima|https://api.clima.example.com
KAN_HTTP_ENDPOINTS=clima|https://api.clima.example.com|Authorization:Bearer xyz,notif|https://notif.example.com
```

**Nunca escanea** — mismo criterio que `KAN_MQTT_BROKERS`/`KAN_ESP32_WIFI_HOSTS`: el host lo fija esta variable, no la conversación. La IA solo puede elegir el `path` dentro de un host ya confiado, nunca un host nuevo — es la única defensa real contra que alguien la convenza de mandar datos a un destino arbitrario (SSRF).

El header de auth (si se configura) va siempre en el request, nunca en el input de la capability ni se loguea — el nombre del dispositivo solo muestra `nombre` + host, nunca el valor del header. **Limitación conocida** (igual que la contraseña con coma en `KAN_MQTT_BROKERS`): un valor de header con coma o pipe rompe el parseo; no vale la pena resolverlo hasta que sea un caso real.

`discover()` sí valida cada endpoint con un GET real a la base (a diferencia de `plugin-gcode`, que nunca prueba nada) — un GET es inofensivo, a diferencia de mandarle G-code a un puerto desconocido. Cualquier respuesta HTTP (incluido un 404 o 401) cuenta como "hay un servidor ahí", mismo criterio que MQTT confirmando solo que hay un broker real, no más que eso.

## Fuera de alcance, a propósito

- Nada de elegir un host en tiempo real desde el chat — si no está en `KAN_HTTP_ENDPOINTS`, no existe como dispositivo.
- Sin reintento de convertir esto en un proxy genérico ("llamá a cualquier URL que te diga") — es exactamente lo que esto NO es.
- Sin streaming/SSE — solo request/response simple.

## Probarlo de verdad

1. Fijá `KAN_HTTP_ENDPOINTS` con una API real y accesible (puede ser algo tan simple como `https://httpbin.org`).
2. Registrá el plugin (paso anterior) y arrancá el Edge Agent — debería descubrir el endpoint.
3. Desde el chat, pedí un `http_get` a un path que exista (ej. `/get` contra httpbin).
4. Probá un `http_post` — debería pedir confirmación en la app de escritorio (ADR-004), no ejecutarse solo.
5. Clasificá ese `path` en Safety Policy si querés cambiar su severidad por defecto.
6. Verificá en `GET /v1/audit` del Gateway que la invocación quedó registrada.
