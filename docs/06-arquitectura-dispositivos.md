# Arquitectura de Dispositivos y Edge Agent

> Ver ADR-001 en [00](00-analisis-y-decisiones.md) — por qué existe el Edge Agent.

## 1. Qué es el Edge Agent

Un proceso que corre en la máquina del usuario (integrado en la app de escritorio Electron, ver ADR-006) responsable de todo lo que el Core Cloud no puede hacer: hablar directamente con hardware.

## 2. Responsabilidades

1. **Device Manager local**: descubre y mantiene el estado real de los dispositivos conectados (a diferencia del Device Manager del Core, que solo guarda metadatos).
2. **Plugin Runtime local**: ejecuta plugins tipo driver (in-process) y gestiona el ciclo de vida de sidecars Python (visión, CAD, CNC) en la máquina local.
3. **Safety & Confirmation Layer**: aplica la política de severidad (ADR-004) — bloquea ejecución de acciones `irreversible-material`/`safety-critical` hasta recibir confirmación explícita, gestiona dry-run/simulación cuando el dispositivo lo soporta, y expone un mecanismo de parada de emergencia independiente del flujo conversacional (puede ser un botón físico/atajo local, no solo un mensaje al chat).
4. **Cola offline**: si se pierde la conexión con el Core Cloud, las tareas ya aprobadas y en curso continúan; las nuevas solicitudes se encolan y sincronizan al reconectar (soporta "Offline First").
5. **Telemetría**: sube progreso/estado/logs al Core Cloud vía el canal persistente (ver doc 07).

## 3. Protocolos soportados (por tipo de dispositivo)

| Dispositivo | Protocolo típico | Notas |
|---|---|---|
| Impresora 3D | Serial/USB (Marlin/Klipper), o red (OctoPrint API) | Reusar integraciones existentes (OctoPrint) en vez de reinventar donde exista |
| CNC / Láser | Serial (GRBL) | G-code; dry-run = simulación de recorrido antes de enviar |
| ESP32 / Arduino | Serial/USB, o WiFi (MQTT/HTTP si el firmware lo soporta) | Plugin puede incluir flujo de "flasheo" de firmware asistido |
| Raspberry Pi | SSH/HTTP (agente ligero corriendo en la Pi) | La Pi puede correr su propio mini Edge Agent si el caso de uso lo justifica |
| PLC | Modbus/OPC-UA | Mundo industrial, protocolos ya estandarizados — adaptador, no reinvención |
| Cámaras / Sensores | RTSP/HTTP, o GPIO local | Frames se procesan localmente cuando sea posible (privacidad + latencia) |
| Robots / Brazos | Depende del fabricante (ROS, APIs propietarias) | Empezar con 1-2 marcas objetivo en el MVP, no "robots" en general |
| Home Assistant / Domótica | HTTP/WebSocket (API nativa de HA) | Aquí KAN es cliente de un hub existente, no reemplaza a HA |

## 4. Descubrimiento de dispositivos

- USB/Serial: enumeración local por el Edge Agent (con permiso del SO).
- Red local: mDNS/Bonjour para dispositivos que lo anuncian (impresoras, HA).
- Emparejamiento manual asistido por conversación cuando no hay autodescubrimiento ("conecta este robot" → KAN pregunta modelo/puerto/IP si no puede descubrirlo solo).

## 5. Registro de dispositivo (flujo)

```
Edge Agent detecta/usuario declara dispositivo
   → Core Cloud crea entrada lógica (Device Manager cloud)
   → se asocia al plugin driver correspondiente
   → se determina el set de capabilities disponibles (y su severidad)
   → dispositivo queda "listo" para recibir AgentTasks
```

## 6. Por qué esto escala a 5 años sin reescritura

Añadir soporte a un dispositivo nuevo es: (a) un plugin driver nuevo que implementa `DevicePort`, (b) opcionalmente un protocolo nuevo si no existe ya un adaptador. Nunca requiere tocar Core Cloud ni el contrato del Edge Agent — esa es la prueba de que el límite Core/Plugin está en el lugar correcto.
