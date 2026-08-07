# Propuestas de Arquitectura — Milestone v0.1

> Revisión completa de la arquitectura al cierre de v0.1. Cada propuesta de abajo es una **mejora identificada, documentada y no implementada** — según lo pedido explícitamente: "si encuentras una decisión mejor, documenta la propuesta, no la implementes todavía". Ordenadas por prioridad recomendada.

## P1 — Validación real de `inputSchema` (JSON Schema) — ✅ Implementado (2026-08-07, ADR-024)

**Problema (histórico).** `CapabilityDescriptor.inputSchema` era un objeto informal (`{ distanceMm: "number" }`), no JSON Schema real. Cada plugin validaba su propio input a mano, sin ninguna garantía de que el próximo plugin lo hiciera. `GeminiProvider.toGeminiSchema()` ya hacía una conversión heurística de ese formato informal al schema real que exige el SDK de Gemini — es decir, ya existía la mitad del trabajo de tener un schema real, solo que no se usaba para validar, solo para informarle al LLM la forma esperada.

**Resuelto.** `CapabilityDescriptor.inputSchema`/`ToolDescriptor.inputSchema` son JSON Schema real (`@kan/plugin-contract`, tipo `JsonSchema`), validado con `ajv` vía `validateAgainstSchema()`. Defensa en profundidad en dos capas, sin tocar `plugin-sdk-ts`: `ToolResolver.resolve()` (Gateway) rechaza args mal formados antes de despachar al Edge Agent, y `CapabilityRegistry.invoke()` (Edge Agent) los rechaza otra vez antes de resolver severidad o tocar el driver — son las dos fronteras de confianza reales (LLM↔Gateway, Gateway↔Edge Agent), no una capa intermedia en el SDK. Ver ADR-024 (`docs/00`) para el detalle y las alternativas descartadas.

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

## P4 — Auditoría completa: invocaciones manuales del Edge Agent — ✅ Implementado (2026-08-07, ADR-025, alcance parcial)

**Problema (histórico).** Documentado en `docs/13` (M3) y `docs/15` (sección 8): acciones disparadas desde los botones "Invocar" de `apps/desktop` no llegaban al `audit.jsonl` del Gateway.

**Resuelto (con alcance limitado).** Nuevo mensaje `AuditLocalMessage` (`packages/plugin-contract/src/protocol.ts`) enviado por `EdgeAgent.invokeCapability()` cuando la invocación se ejecuta de inmediato; `Gateway.bootstrap()` lo registra en `AuditService` con `actor: "user"`. **Corrección sobre la propuesta original:** la premisa "si el Edge Agent está offline, se encola igual que cualquier otro dato pendiente de sincronizar (Modo Offline, ya diseñado)" no correspondía a código real — esa cola no existe en el repositorio (`CoreWebSocketClient.send()` es fire-and-forget para cualquier mensaje). `audit.local` no la construye; hereda el mismo comportamiento fire-and-forget que ya tiene `safety_policy.changed` en producción. **Limitación conocida, fuera de este incremento a propósito:** una acción peligrosa manual que queda `pending_confirmation` y se resuelve después en el modal de `apps/desktop` (`resolveConfirmation()`) todavía no genera entrada de auditoría — justo las acciones de mayor riesgo. Ver ADR-025 (`docs/00`) para el detalle completo.

## P5 — Desambiguación multi-dispositivo y tareas compuestas en el Task Orchestrator

**Problema.** Ya documentado como seam explícito en `docs/12` §4: `TaskOrchestrator.submit()` acepta un único paso. Cuando el usuario tenga dos impresoras y diga "imprime esto", no hay mecanismo para decidir cuál, ni para encadenar "diseña y luego imprime" como una sola operación con dependencias.

**Propuesta.** `submitPlan(plan: TaskPlan)` donde `TaskPlan = { steps: TaskRequest[], edges: Array<[number, number]> }` — pasos sin dependencias entre sí se despachan en paralelo (`Promise.all`), los que dependen de otro esperan su resultado antes de construir su propio `payload`. La desambiguación de "cuál impresora" se resuelve en el `ToolResolver`/`ToolExecutor` antes de llegar al Orchestrator: si `ref` es ambiguo (más de un dispositivo satisface la intención), se le devuelve al LLM una pregunta aclaratoria en vez de un error — el propio LLM puede preguntarle al usuario cuál prefiere.

**Costo estimado:** alto — es esencialmente el diseño de un mini-scheduler de grafo de dependencias, y cambia la forma en que `ToolExecutor` decide "un solo `ref`" vs "necesito preguntar".

**Prioridad:** baja — no hay todavía un caso de uso real que lo necesite (con un solo Edge Agent y un solo dispositivo simulado, la ambigüedad no existe). Construir esto ahora sería especulativo.

## P6 — Rate limiting en el Gateway — ✅ Implementado (2026-08-07, ADR-025)

**Problema (histórico).** Documentado en `docs/13` (M4) y `docs/15` (secciones 5 y 9): sin límite de conexiones WS concurrentes ni de requests HTTP por unidad de tiempo.

**Resuelto.** `express-rate-limit` en `createRoutes()` (`apps/gateway`), aplicado antes del chequeo de token — 120 req/min por IP por defecto, configurable vía env. `WsConnectionManager` gana un cap de conexiones concurrentes (default 50), aplicado en `handleUpgrade()`. **Precisión sobre la propuesta original:** el cap es **global**, no "por token" — hoy el Gateway usa un único token compartido para todos los Edge Agents, sin identidad por token; un límite "por token" no tiene sentido hasta que exista esa identidad (P2). Ver ADR-025 (`docs/00`).

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
| P1 | Validación JSON Schema real | ✅ Implementado (ADR-024) | — |
| P2 | Auth/autorización por usuario | Alta | Compartir el sistema con más de un usuario |
| P3 | Persistencia real del Gateway | Media | Multi-instancia / durabilidad del audit trail |
| P4 | Auditoría de invocaciones manuales | ✅ Implementado, alcance parcial (ADR-025) | Auditar confirmaciones manuales queda pendiente |
| P6 | Rate limiting | ✅ Implementado (ADR-025) | — |
| P7 | Streaming del chat | Baja → Alta | El primer dispositivo con operaciones largas |
| P5 | Multi-dispositivo / tareas compuestas | Baja | Un caso de uso real con >1 dispositivo del mismo tipo |
| P8 | `LoggerPort` compartido | Muy baja | Nada — higiene de consistencia |
