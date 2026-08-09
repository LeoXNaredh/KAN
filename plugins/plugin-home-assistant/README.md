# @kan/plugin-home-assistant

Cliente REST de una instancia de Home Assistant ya existente — KAN no reemplaza a HA, es un cliente más, igual que `@kan/plugin-mqtt` es cliente de un broker existente (docs/06, docs/11). Usa el transporte de `@kan/plugin-http-generic` tal cual (`FetchHttpTransport`) en vez de duplicar un cliente HTTP.

A diferencia de `docs/04-arquitectura-plugins.md` (que lo lista como ejemplo de plugin "Skill/Integración"), este plugin se implementa como **driver de dispositivo**: Home Assistant controla actuadores físicos reales (cerraduras, portones, climatización) — exactamente el dominio que Safety Policy existe para cubrir.

No asume qué hace un servicio. `call_ha_service` es `irreversible-material` por defecto (pide confirmación) hasta que el usuario reclasifique esa `entity_id` en el panel **Safety Policy** — mismo mecanismo que topics MQTT o paths de `plugin-http-generic`.

## Capabilities

- `list_ha_entities()` — read-only. Todas las entidades conocidas con su estado actual.
- `get_ha_state(entity_id)` — read-only.
- `call_ha_service(domain, service, entity_id, data?)` — irreversible-material por defecto. Ej.: `{domain: "light", service: "turn_on", entity_id: "light.living_room", data: {brightness: 128}}`.

Un "dispositivo" es una instancia de Home Assistant configurada. Cada `entity_id` es un target direccionable en Safety Policy — a diferencia de MQTT (que los va poblando a medida que te suscribís), acá se puebla **todos de una** al conectar: `GET /api/states` ya trae todas las entidades conocidas, no hace falta "suscribirse" primero.

### Severidad por defecto según el dominio del entity_id

| Dominio | Severidad por defecto |
|---|---|
| `lock`, `alarm_control_panel` | `safety-critical` |
| `switch`, `light`, `climate`, `cover`, `fan`, `vacuum`, `media_player`, `humidifier`, `water_heater`, `lawn_mower`, `valve` | `irreversible-material` |
| Cualquier otro (`sensor`, `binary_sensor`, `person`, `sun`, `weather`...) | `read-only` |

Es solo un punto de partida — el usuario reclasifica cualquier `entity_id` individual en Safety Policy, esto nunca es la última palabra.

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que el resto de los plugins de hardware/red). Para habilitarlo:

```ts
import { HomeAssistantDevicePlugin } from "@kan/plugin-home-assistant";

await agent.registerPlugin(new HomeAssistantDevicePlugin());
```

## Configuración — `KAN_HOME_ASSISTANT_INSTANCES`

`nombre|baseUrl|token` separados por coma. El token es un [Long-Lived Access Token](https://www.home-assistant.io/docs/authentication/#your-account-profile) generado desde tu perfil de usuario en HA:

```
KAN_HOME_ASSISTANT_INSTANCES=casa|http://homeassistant.local:8123|eyJhbGciOi...
```

A diferencia de `KAN_HTTP_ENDPOINTS`/`KAN_WS_ENDPOINTS` (que aceptan cualquier header), acá el formato es más simple porque HA siempre usa `Authorization: Bearer <token>` — no hace falta el escape hatch genérico. **Nunca escanea** — mismo criterio que el resto de las variables `KAN_*_ENDPOINTS`/`_INSTANCES`/`_BROKERS`: el host lo fija esta variable, no la conversación.

`discover()` valida tanto alcanzabilidad como que el token sea válido (`GET /api/`, que HA usa como healthcheck autenticado) — a diferencia de `plugin-http-generic` (que no puede saber si un endpoint arbitrario exige auth), acá sabemos que HA siempre la exige, así que un token inválido descarta la instancia igual que un host inalcanzable.

## Fuera de alcance, a propósito

- Nada de elegir una instancia en tiempo real desde el chat — si no está en `KAN_HOME_ASSISTANT_INSTANCES`, no existe como dispositivo.
- Sin WebSocket/eventos en tiempo real (`home-assistant-js-websocket`) — la REST API alcanza para un modelo de capabilities de request/response; si hace falta empujar cambios de estado en vivo, es una fase futura, no este incremento.
- Sin gestión de automatizaciones/escenas de HA — solo estado y servicios de entidades.

## Probarlo de verdad

1. Generá un Long-Lived Access Token desde tu perfil de usuario en Home Assistant.
2. Fijá `KAN_HOME_ASSISTANT_INSTANCES` con tu URL y token real.
3. Registrá el plugin (paso anterior) y arrancá el Edge Agent — debería descubrir la instancia.
4. Desde el chat, pedí `list_ha_entities` para ver qué hay disponible.
5. Pedí algo como "prendé la luz del living" — debería pedir confirmación en la app de escritorio (ADR-004) la primera vez, salvo que ya hayas clasificado esa entidad como `reversible` en Safety Policy.
6. Verificá en `GET /v1/audit` del Gateway que la invocación quedó registrada.
