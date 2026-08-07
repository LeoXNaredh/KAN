# @kan/plugin-mqtt

Cliente MQTT genérico: conecta a un broker que ya exista (Mosquitto, HiveMQ, etc.) para leer sensores y controlar actuadores IoT que hablan MQTT. KAN **no aloja su propio broker** en esta fase — es un cliente más, igual que cualquier sensor o actuador que ya publique/se suscriba a ese broker (ver ADR-022, `docs/00`).

No asume qué escucha un topic. `publish_mqtt` es `irreversible-material` por defecto (pide confirmación) hasta que el usuario clasifique ese topic explícitamente en el panel **Safety Policy** de la app de escritorio — mismo mecanismo que direcciones BLE (`@kan/plugin-bluetooth-generic`) o pines ESP32 (`@kan/plugin-esp32-arduino`), sin tocar esa infraestructura.

## Capabilities

- `subscribe_mqtt(topic)` — read-only. Soporta wildcards MQTT (`+` un nivel, `#` el resto).
- `unsubscribe_mqtt(topic)` — reversible. Idempotente: si el topic no estaba suscrito, no falla.
- `read_mqtt(topic)` — read-only. Devuelve el último valor cacheado; error claro si todavía no llegó nada.
- `publish_mqtt(topic, payload, qos?, retain?)` — irreversible-material por defecto. Sin dry-run: no hay forma genérica de previsualizar qué causaría un mensaje en un suscriptor desconocido.
- `list_mqtt_topics()` — read-only, sin target. Lista los topics suscritos con su último valor conocido.

Un "dispositivo" es una conexión a un broker configurado (no un sensor individual) — cada topic al que te suscribís se vuelve un target direccionable en Safety Policy.

## Uso

No se registra automáticamente en `apps/desktop` (mismo criterio que `plugin-esp32-arduino`/`plugin-bluetooth-generic`). Para habilitarlo, en `apps/desktop/src/main/index.ts`:

```ts
import { MqttDevicePlugin } from "@kan/plugin-mqtt";

await agent.registerPlugin(new MqttDevicePlugin());
```

## Configuración

`KAN_MQTT_BROKERS` — URLs de broker separadas por coma, nunca escanea la red (mismo patrón que `KAN_ESP32_WIFI_HOSTS`):

```
KAN_MQTT_BROKERS=mqtt://192.168.1.10:1883
KAN_MQTT_BROKERS=mqtt://usuario:contraseña@192.168.1.10:1883,mqtts://broker.hivemq.com:8883
```

Las credenciales van en la URL (`mqtt://usuario:contraseña@host:puerto`) y nunca se loguean ni aparecen en el nombre del dispositivo — `discover()` solo muestra `protocolo//host:puerto`. **Limitación conocida:** una contraseña que contenga una coma rompe el separado por comas de `KAN_MQTT_BROKERS` — no vale la pena resolverlo hasta que sea un caso real; usá una contraseña sin comas o un solo broker por ahora.

`discover()` valida cada URL conectando de verdad y esperando la confirmación del broker (evento `connect` de `mqtt.js`, posterior al CONNACK) — a diferencia de ESP32, un broker MQTT genérico no tiene forma de confirmar "esto es hardware consciente de KAN"; solo se puede confirmar "hay un broker real ahí", no más que eso.

## Reconexión

Se apoya en la reconexión nativa de `mqtt.js` (período fijo, no backoff exponencial como en el transporte TCP de ESP32 — ver ADR-022) y su resubscribe automático (los topics ya suscritos se vuelven a suscribir solos tras una caída, sin que el plugin haga nada). Por defecto reintenta indefinidamente — un broker es infraestructura estable, no una placa que puede desaparecer para siempre. Si querés un tope, `NodeMqttTransportTuning.maxReconnectAttempts` lo agrega (opt-in, sin default).

## Probarlo de verdad

1. Asegurate de tener un broker MQTT corriendo y alcanzable (Mosquitto local, HiveMQ Cloud, etc.).
2. Fijá `KAN_MQTT_BROKERS` con su URL y registrá el plugin (paso anterior).
3. Arrancá el Edge Agent (`apps/desktop`) — debería descubrir y poder conectar el broker.
4. Desde el chat, pedí suscribirte a un topic real que tu broker use (ej. `subscribe_mqtt` a `casa/jardin/humedad`).
5. Clasificá ese topic en el panel **Safety Policy** si querés cambiar su severidad por defecto.
6. Probá `publish_mqtt` en algún topic desde el chat — debería pedir confirmación en la app de escritorio (ADR-004), no ejecutarse solo.
7. Verificá en `GET /v1/audit` del Gateway que la invocación quedó registrada.
