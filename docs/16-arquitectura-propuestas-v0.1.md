# Propuestas de Arquitectura — Milestone v0.1

> Revisión completa de la arquitectura al cierre de v0.1. Cada propuesta de abajo es una **mejora identificada, documentada y no implementada** — según lo pedido explícitamente: "si encuentras una decisión mejor, documenta la propuesta, no la implementes todavía". Ordenadas por prioridad recomendada.

## P1 — Validación real de `inputSchema` (JSON Schema)

**Problema.** `CapabilityDescriptor.inputSchema` es un objeto informal (`{ distanceMm: "number" }`), no JSON Schema real. Cada plugin valida su propio input a mano — el simulador lo hace bien tras la Fase 3 de estabilización, pero no hay ninguna garantía de que el próximo plugin lo haga. `GeminiProvider.toGeminiSchema()` ya hace una conversión heurística de este formato informal al schema real que exige el SDK de Gemini — es decir, ya existe la mitad del trabajo de tener un schema real, solo que no se usa para validar, solo para informarle al LLM la forma esperada.

**Propuesta.** Adoptar JSON Schema real (`zod` con `zod-to-json-schema`, o `ajv` directo) en `packages/plugin-contract`:
- `CapabilityDescriptor.inputSchema` pasa a ser un JSON Schema válido de verdad.
- `plugin-sdk-ts` valida el input contra el schema **antes** de llamar a `plugin.invoke()` — el plugin ya no necesita repetir la validación básica de tipos, solo su lógica de negocio.
- `packages/gateway-core`'s `ToolResolver` valida los `args` propuestos por el LLM contra el schema **antes** de que lleguen siquiera al Edge Agent — defensa en profundidad, dos capas de validación (Gateway y Edge Agent) en vez de una.

**Costo estimado:** medio (una tarde) — el cambio de tipo se propaga a `plugin-device-simulator` (reescribir `getCapabilities()`), `GeminiProvider.toGeminiSchema()` (simplifica, ya no necesita heurística), y un nuevo paso de validación en `ToolResolver`/`plugin-sdk-ts`.

**Prioridad:** la más alta de este documento — **bloqueante recomendado antes de construir `plugin-esp32-arduino`**, tal como quedó señalado en `docs/13` (M1) y `docs/15` (sección 3).

## P2 — Autenticación y autorización por usuario

**Problema.** Ya documentado extensamente en `docs/13` (C1) y `docs/15` (secciones 1-2): no existe el concepto de usuario. Es la brecha de seguridad más grande del sistema, y es trabajo de funcionalidad real, no un fix de estabilización.

**Propuesta concreta** (más allá de "usar Supabase Auth", que ya estaba en el roadmap):
1. `apps/web` gana sesión de usuario (Supabase Auth, ya en el stack — `docs/08`).
2. El JWT de sesión viaja en cada llamada de `GatewayToolProvider` hacia el Gateway (header adicional, no reemplaza el token interno — son capas distintas: el token interno autentica *que la llamada viene de apps/web*, el JWT autentica *qué usuario la hizo*).
3. El Gateway valida el JWT y lo asocia a cada `AgentRecord` (qué Edge Agents pertenecen a qué usuario) y a cada entrada de `AuditEntry` (quién disparó qué).
4. `TaskOrchestrator.submit()` rechaza si el `edgeAgentId` resuelto no pertenece al usuario del JWT — un usuario nunca puede, ni por error, invocar el dispositivo de otro.

**Costo estimado:** alto (varios días) — toca `AgentRegistry` (añadir `ownerId`), el protocolo `hello` (el Edge Agent necesita saber a qué cuenta pertenece, probablemente vía un token de emparejamiento generado en `apps/web` al momento de instalar el Edge Agent), y toda la superficie HTTP del Gateway.

**Prioridad:** alta, pero explícitamente **no bloqueante para seguir con ESP32 en un entorno de un solo usuario** — bloqueante solo para compartir el sistema con alguien más.

## P3 — Persistencia real para el estado del Gateway

**Problema.** `AgentRegistry`, `GlobalCapabilityRegistry` y `JsonlAuditStore` viven en memoria/archivo local del proceso del Gateway. Un reinicio del Gateway pierde el registro de agentes (se reconstruye al reconectar, aceptable) pero el histórico de auditoría queda solo en ese archivo local, sin réplica ni backup.

**Propuesta.** Los puertos ya están diseñados para este swap sin tocar el dominio (mismo patrón que ADR-007 para `apps/web`): `AuditStorePort` → adaptador Supabase (tabla `audit_entries`) en vez de `JsonlAuditStore`; opcionalmente `AgentRegistry`/`GlobalCapabilityRegistry` respaldados por Redis si el Gateway llega a correr en más de una instancia (hoy asume un solo proceso — ver P5).

**Costo estimado:** bajo para el Audit Store (un adaptador nuevo detrás del puerto existente), medio para Agent/Capability Registry si se requiere multi-instancia.

**Prioridad:** media — no urgente mientras el Gateway corra como un solo proceso de un solo desarrollador.

## P4 — Auditoría completa: invocaciones manuales del Edge Agent

**Problema.** Documentado en `docs/13` (M3) y `docs/15` (sección 8): acciones disparadas desde los botones "Invocar" de `apps/desktop` no llegan al `audit.jsonl` del Gateway.

**Propuesta.** Extender el protocolo (`packages/plugin-contract/src/protocol.ts`) con un nuevo mensaje `EdgeToCoreMessage`, ej. `{ type: "audit.local", capability, deviceId, result, at }`, que el Edge Agent envía además de la telemetría normal cada vez que `CapabilityRegistry.invoke()` se dispara sin que haya venido de un `AgentTaskDispatchMessage` del Gateway (es decir, iniciado localmente). El Gateway lo recibe y lo registra en `AuditService` igual que cualquier otra ejecución, con `actor: "user"` en vez de `"llm"`. Si el Edge Agent está offline, se encola igual que cualquier otro dato pendiente de sincronizar (Modo Offline, ya diseñado).

**Costo estimado:** bajo (medio día) — extensión de protocolo + un handler nuevo en `Gateway.bootstrap()`.

**Prioridad:** media — no es una vulnerabilidad, es una brecha de completitud del audit trail.

## P5 — Desambiguación multi-dispositivo y tareas compuestas en el Task Orchestrator

**Problema.** Ya documentado como seam explícito en `docs/12` §4: `TaskOrchestrator.submit()` acepta un único paso. Cuando el usuario tenga dos impresoras y diga "imprime esto", no hay mecanismo para decidir cuál, ni para encadenar "diseña y luego imprime" como una sola operación con dependencias.

**Propuesta.** `submitPlan(plan: TaskPlan)` donde `TaskPlan = { steps: TaskRequest[], edges: Array<[number, number]> }` — pasos sin dependencias entre sí se despachan en paralelo (`Promise.all`), los que dependen de otro esperan su resultado antes de construir su propio `payload`. La desambiguación de "cuál impresora" se resuelve en el `ToolResolver`/`ToolExecutor` antes de llegar al Orchestrator: si `ref` es ambiguo (más de un dispositivo satisface la intención), se le devuelve al LLM una pregunta aclaratoria en vez de un error — el propio LLM puede preguntarle al usuario cuál prefiere.

**Costo estimado:** alto — es esencialmente el diseño de un mini-scheduler de grafo de dependencias, y cambia la forma en que `ToolExecutor` decide "un solo `ref`" vs "necesito preguntar".

**Prioridad:** baja — no hay todavía un caso de uso real que lo necesite (con un solo Edge Agent y un solo dispositivo simulado, la ambigüedad no existe). Construir esto ahora sería especulativo.

## P6 — Rate limiting en el Gateway

**Problema.** Documentado en `docs/13` (M4) y `docs/15` (secciones 5 y 9): sin límite de conexiones WS concurrentes ni de requests HTTP por unidad de tiempo.

**Propuesta.** `express-rate-limit` (o equivalente) en las rutas HTTP del Gateway; un límite de conexiones WS simultáneas por token en `WsConnectionManager` (hoy no hay tope). Ambos son cambios pequeños y aislados.

**Costo estimado:** bajo (un par de horas).

**Prioridad:** baja mientras el Gateway sea de un solo usuario/agente; **sube a alta** en cuanto se abra a llamadores de terceros (marketplace, Fase 2+) — debería resolverse como parte de esa misma iniciativa, no antes.

## P7 — Streaming de respuestas del chat

**Problema.** `SendMessageUseCase.execute()` devuelve la conversación completa solo al terminar todas las rondas de tool-calling — con el simulador esto es casi instantáneo, pero en cuanto una capability real tarde segundos/minutos (una impresión 3D, un corte de CNC), el usuario se queda mirando "KAN está pensando…" sin ninguna señal de progreso intermedio.

**Propuesta.** `/api/chat` como respuesta streaming (Server-Sent Events o `ReadableStream` de Next.js) en vez de JSON de una sola pieza; `SendMessageUseCase` emite eventos incrementales (tool propuesta → tool ejecutándose → tool completada → respuesta final) que la ruta traduce a chunks SSE. El Gateway ya tiene la pieza que falta del lado servidor: `TaskOrchestrator` descarta hoy la telemetría de tipo `"progress"` (`handleTelemetry`, `if (message.status === "progress") return`) — literalmente reservado para esto y sin usar.

**Costo estimado:** medio — cambia la forma de `SendMessageUseCase` (de retornar una promesa a exponer un iterable/callback de progreso) y la ruta HTTP de `apps/web`.

**Prioridad:** baja para v0.1 (el simulador no lo necesita), **sube a alta en cuanto exista el primer dispositivo con operaciones de duración real** (impresión 3D, corte CNC) — momento en que un chat sin feedback de progreso se sentiría roto, no solo mejorable.

## P8 — `LoggerPort` para `gateway-core` (consistencia con `edge-agent-core`)

**Problema.** `packages/edge-agent-core` tiene un `LoggerPort` propio con adaptador `FileAndConsoleLogger`, testeable y sustituible. `packages/gateway-core` usa `console.log`/`console.error`/`console.warn` directo en `NoopScheduler`, `JsonlAuditStore` y `apps/gateway/src/server.ts` — funciona, pero no es consistente con el patrón ya establecido, y dificulta capturar logs del Gateway en tests (hoy no se prueba lo que se loguea, solo el comportamiento).

**Propuesta.** Extraer un `LoggerPort` compartido (candidato natural para vivir en `packages/plugin-contract`, ya que tanto `edge-agent-core` como `gateway-core` lo necesitarían) y un adaptador `ConsoleLogger` simple para el Gateway (sin necesidad del archivo local que sí tiene sentido para el Edge Agent, dado que el Gateway ya persiste su audit trail aparte).

**Costo estimado:** bajo (una tarde) — mueve interfaz, sin lógica nueva.

**Prioridad:** muy baja — es higiene de consistencia, no resuelve ningún bug ni riesgo real.

---

## Resumen de prioridades

| # | Propuesta | Prioridad | Bloqueante para |
|---|---|---|---|
| P1 | Validación JSON Schema real | **Alta** | `plugin-esp32-arduino` y cualquier plugin de hardware real |
| P2 | Auth/autorización por usuario | Alta | Compartir el sistema con más de un usuario |
| P3 | Persistencia real del Gateway | Media | Multi-instancia / durabilidad del audit trail |
| P4 | Auditoría de invocaciones manuales | Media | Completitud de compliance |
| P6 | Rate limiting | Baja → Alta | Abrir el Gateway a terceros (marketplace) |
| P7 | Streaming del chat | Baja → Alta | El primer dispositivo con operaciones largas |
| P5 | Multi-dispositivo / tareas compuestas | Baja | Un caso de uso real con >1 dispositivo del mismo tipo |
| P8 | `LoggerPort` compartido | Muy baja | Nada — higiene de consistencia |
