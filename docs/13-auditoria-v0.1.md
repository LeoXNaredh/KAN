# Auditoría Técnica — Cierre de Milestone v0.1

> Auditoría de solo lectura hecha antes de modificar código, como pidió el usuario. Cubre todo lo construido hasta ahora: `packages/core`, `packages/ai-abstraction`, `packages/edge-agent-core`, `packages/gateway-core`, `packages/plugin-contract`, `packages/plugin-sdk-ts`, `plugins/plugin-device-simulator`, `apps/web`, `apps/desktop`, `apps/gateway`. Se hizo con tres revisiones independientes en paralelo (calidad/arquitectura, concurrencia/performance, seguridad) y luego se dedujeron los hallazgos duplicados entre las tres.

## Veredicto general

El código es consistente con la arquitectura documentada: el grafo de dependencias real (verificado package.json por package.json) respeta las reglas — `@kan/core` solo depende de `@kan/plugin-contract`, `edge-agent-core` no depende de `@kan/core`, los plugins solo dependen de `plugin-sdk-ts`/`plugin-contract`, sin dependencias circulares. No hay duplicación de código no intencional (el mirror `EdgeAgentBus`/`GatewayBus` es diseño deliberado, no duplicación). Ninguna clase está sobredimensionada al punto de necesitar partirse ahora.

Los problemas reales se concentran en tres frentes: **validación de input ausente en los plugins** (bugs de correctness demostrables, no hipotéticos), **estado sin cota de vida** en estructuras de larga duración del Gateway (memory leaks previsibles) y **ausencia de un eje de autorización por usuario** (aceptable en dev local, bloqueante para cualquier cosa más allá de localhost). Nada requiere reescritura.

---

## CRÍTICO

### C1 — No existe autorización a nivel de usuario en ningún punto del sistema
`apps/web/app/api/chat/route.ts`, `apps/gateway/src/http/routes.ts`. El único control de acceso es un token compartido (`KAN_GATEWAY_INTERNAL_TOKEN`) que protege todo el API del Gateway por igual — no hay Supabase Auth ni el eje de "permisos por usuario" que ADR-008/docs/03 §1.5 ya diseñaron pero nunca se implementó (solo existe el eje de severidad por plugin, ADR-004). Cualquiera que llegue al endpoint de chat puede invocar cualquier capability de cualquier Edge Agent conectado.
**Aceptable para v0.1 dev local. Bloqueante antes de exponer esto fuera de `localhost` o a más de un usuario.**

---

## ALTO

| # | Hallazgo | Archivo | Impacto |
|---|---|---|---|
| A1 | `Boolean("false") === true` — bug de correctness real | `plugins/plugin-device-simulator/src/index.ts:81` | Un `on` que llega como string `"false"` invierte el comportamiento sin error visible |
| A2 | `NaN` corrompe el estado permanentemente | `plugins/plugin-device-simulator/src/index.ts:87` | `distanceMm` no numérico → `axisPositionMm` queda en `NaN` hasta reiniciar la app |
| A3 | `TaskOrchestrator.tasks` crece sin límite | `packages/gateway-core/src/application/TaskOrchestrator.ts:23,46` | Memory leak lineal con el número de tareas ejecutadas desde el arranque del Gateway |
| A4 | `WsConnectionManager` no protege contra un segundo `hello` ni colisión de `edgeAgentId` | `packages/gateway-core/src/infra/WsConnectionManager.ts:106-134` | Mapa de conexiones puede quedar inconsistente; conexión zombie si dos sockets reclaman el mismo id |
| A5 | Race condition: la ventana carga antes de que los handlers IPC estén listos | `apps/desktop/src/main/index.ts:112-115` | Con un plugin más lento que el simulador, `invoke` fallaría con "No handler registered" |
| A6 | Errores de `invokeCapability` se descartan en silencio en la UI | `apps/desktop/src/renderer/src/App.tsx:86-88` | El `void` sin `.catch()` esconde fallos del usuario |
| A7 | `fetch()` sin timeout en `GatewayToolProvider` puede colgar el chat indefinidamente | `apps/web/lib/gateway/GatewayToolProvider.ts:17,28` | Si el Gateway acepta la conexión TCP pero no responde, `/api/chat` queda esperando sin límite |
| A8 | Escritura síncrona de disco en el hot path del Gateway | `packages/gateway-core/src/infra/JsonlAuditStore.ts:14` | `appendFileSync` en cada ejecución de tool bloquea el único hilo del proceso; alimenta directamente A7 |
| A9 | Sin `maxPayload` en el servidor WebSocket | `packages/gateway-core/src/infra/WsConnectionManager.ts:29` | Mensajes de hasta 100MB (default de `ws`) aceptados sin límite — DoS de memoria |
| A10 | Puertos de pub-sub sin forma de des-suscribirse | `ConnectionManagerPort`, `CoreConnectionPort` | No es leak activo hoy (una suscripción por proceso), pero **va a doler en la Fase de testing** — cualquier test que recree composition roots acumulará handlers fantasma |
| A11 | `SendMessageUseCase` sin timeout global de request | `packages/core/src/application/use-cases/SendMessageUseCase.ts:14,48` | Peor caso teórico >60s (4 rondas × 15s de `TaskOrchestrator` + latencia de Gemini) — ya excede el límite de función serverless que el propio ADR-001 documenta |

---

## MEDIO

| # | Hallazgo | Archivo |
|---|---|---|
| M1 | `move_axis` no valida rango/tipo real de `distanceMm` — la validación de `inputSchema` diferida deja de ser aceptable en cuanto exista un plugin de hardware real | `plugins/plugin-device-simulator/src/index.ts:86-90` |
| M2 | Comparación de tokens con `!==` (no constant-time) | `WsConnectionManager.ts:51`, `apps/gateway/src/http/routes.ts:13` |
| M3 | Auditoría incompleta: invocaciones manuales desde la UI del Edge Agent no llegan al `audit.jsonl` del Gateway | `packages/edge-agent-core/src/application/CapabilityRegistry.ts` |
| M4 | Sin rate limiting ni límite de conexiones concurrentes (WS ni HTTP) | `WsConnectionManager.ts`, `apps/gateway/src/http/routes.ts` |
| M5 | Sin validación de forma en mensajes WS más allá del `try/catch` del `JSON.parse` — mensajes con forma inesperada se ignoran en silencio | `WsConnectionManager.onSocketMessage` |
| M6 | `PermissionManager.pending` no expira nunca — confirmaciones ignoradas quedan huérfanas | `packages/edge-agent-core/src/application/PermissionManager.ts:18` |
| M7 | Handler de `"error"` del WebSocket vacío, sin loguear | `packages/edge-agent-core/src/infra/CoreWebSocketClient.ts:99-101` |
| M8 | `GlobalCapabilityRegistry.resolve()`/`list()` son O(n) sin índice — cada ejecución de tool escanea todas las capabilities de todos los agentes | `packages/gateway-core/src/application/GlobalCapabilityRegistry.ts:34-40` |
| M9 | `JsonlAuditStore.list()` relee y re-parsea el archivo completo en cada `GET /v1/audit`, sin paginación | `packages/gateway-core/src/infra/JsonlAuditStore.ts:17-29` |
| M10 | `apps/gateway` solo maneja `SIGINT`, no `SIGTERM` ni `uncaughtException`/`unhandledRejection` | `apps/gateway/src/server.ts` |
| M11 | `ModelRouter` no tiene fallback real pese a que la documentación (ADR-007) lo describe como "lo que hace seguro" quedarse sin cuota de Gemini — brecha documentación-vs-código | `packages/ai-abstraction/src/router.ts` |
| M12 | `DeviceManager.discoverAll()` descubre dispositivos secuencialmente, no en paralelo — escalará mal con múltiples drivers reales | `packages/edge-agent-core/src/application/DeviceManager.ts:21-43` |
| M13 | Reescritura completa del archivo en cada `set()` de configuración | `packages/edge-agent-core/src/infra/JsonFileConfigStore.ts:39-43` |
| M14 | `AgentRegistry.markOnline()` reescribe redundantemente lo que `upsert()` ya fijó | `packages/gateway-core/src/Gateway.ts:69-70` |
| M15 | `AgentRegistry` deja entradas huérfanas si un Edge Agent se reinstala (nuevo `edgeAgentId`) | `packages/gateway-core/src/application/AgentRegistry.ts` |

---

## BAJO

| # | Hallazgo | Archivo |
|---|---|---|
| L1 | Tokens por defecto (`dev-token`, `dev-internal-token`) coinciden entre `.env.example` y los fallbacks hardcodeados en código — riesgo si un despliegue descuidado no los cambia | `apps/desktop/src/main/index.ts:50`, `apps/web/app/api/chat/route.ts:19` |
| L2 | `sandbox: false` en el `BrowserWindow` de Electron | `apps/desktop/src/main/index.ts:97` |
| L3 | WS sin verificación de `Origin` (mitigado parcialmente porque el navegador no permite fijar `Authorization` en el handshake WS) | `WsConnectionManager.ts` |
| L4 | Prompt injection conceptual: resultado de una tool vuelve al LLM sin sanitizar — sin superficie real hoy (el simulador solo devuelve números), relevante en cuanto exista un plugin de visión/OCR | `packages/ai-abstraction/src/providers/gemini/GeminiProvider.ts` |
| L5 | Logs/audit no filtran contenido sensible; sin rotación — el archivo crece sin límite | `FileAndConsoleLogger.ts`, `JsonlAuditStore.ts` |
| L6 | Import no usado (`Part`) | `packages/ai-abstraction/src/providers/gemini/GeminiProvider.ts:6` |
| L7 | Backoff de reconexión sin jitter — riesgo de reconexiones sincronizadas en oleada con múltiples Edge Agents | `packages/edge-agent-core/src/infra/CoreWebSocketClient.ts:104-110` |
| L8 | Tipado `any` en el borde IPC del renderer | `apps/desktop/src/renderer/src/App.tsx:12` |
| L9 | `mapSchemaType` cae silenciosamente a `STRING` ante un valor no reconocido | `packages/ai-abstraction/src/providers/gemini/GeminiProvider.ts:108-113` |

---

## Lo que se verificó y está bien (no asumido, comprobado)

- Resolución de `TaskOrchestrator.pending`: protegida contra doble resolución (timeout vs. telemetría) por el guard `if (!pending) return` — segura por el single-thread de Node, sin necesitar locks.
- `PermissionManager.resolve()` ante doble confirmación: `pending.delete()` atómico dentro de la llamada síncrona — segura.
- Cierre/reconexión de sockets en `WsConnectionManager`: la guarda `byAgentId.get(id) === conn` en `onSocketClosed` previene que un cierre viejo borre una reconexión nueva — bien defendido.
- `DeviceSimulatorPlugin.invoke()`: no hay `await` entre leer y escribir `this.state`, así que invocaciones concurrentes no se entrelazan — pero es una propiedad *accidental* del simulador, no una garantía del `DeviceDriverPort`. **Un driver real que haga `await` entre leer y escribir estado compartido sí será vulnerable** — vale la pena documentar esto como contrato esperado antes del primer driver de hardware real.

## Priorización recomendada para la Fase 3 (fixes)

1. **A1, A2, M1** — validación de input en el simulador (son el mismo problema: falta de validación antes de mutar estado). Bloqueante conceptual antes de ESP32/CNC.
2. **A3, A9, A10** — memory leak de tasks, límite de payload WS, capacidad de unsubscribe (esto último para no arrastrar el problema a la Fase 4 de testing).
3. **A7, A8** — timeout en fetch del Gateway + auditoría asíncrona (mismo problema de fondo: I/O bloqueante sin límite de tiempo).
4. **A4, A5, A6, A11** — robustez de protocolo y manejo de errores.
5. **M2, M6, M7, M10** — endurecimiento de bajo costo.
6. **M8, M9, M11-M15** — performance, se documentan en el informe de performance (Fase 5) y se arreglan solo si son triviales; el resto queda como deuda técnica explícita en el informe final.
7. **C1** — no se soluciona en v0.1 (requiere Supabase Auth, ya en el roadmap Fase 2); se documenta como limitación conocida en RELEASE_NOTES.
8. Resto de **BAJO** — se arreglan de paso si son de una línea (L6, L9); el resto se documenta como deuda.
