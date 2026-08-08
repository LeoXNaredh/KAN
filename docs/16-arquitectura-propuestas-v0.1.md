# Propuestas de Arquitectura — Milestone v0.1

> Revisión completa de la arquitectura al cierre de v0.1. Cada propuesta de abajo es una **mejora identificada, documentada y no implementada** — según lo pedido explícitamente: "si encuentras una decisión mejor, documenta la propuesta, no la implementes todavía". Ordenadas por prioridad recomendada.

## P1 — Validación real de `inputSchema` (JSON Schema) — ✅ Implementado (2026-08-07, ADR-024)

**Problema (histórico).** `CapabilityDescriptor.inputSchema` era un objeto informal (`{ distanceMm: "number" }`), no JSON Schema real. Cada plugin validaba su propio input a mano, sin ninguna garantía de que el próximo plugin lo hiciera. `GeminiProvider.toGeminiSchema()` ya hacía una conversión heurística de ese formato informal al schema real que exige el SDK de Gemini — es decir, ya existía la mitad del trabajo de tener un schema real, solo que no se usaba para validar, solo para informarle al LLM la forma esperada.

**Resuelto.** `CapabilityDescriptor.inputSchema`/`ToolDescriptor.inputSchema` son JSON Schema real (`@kan/plugin-contract`, tipo `JsonSchema`), validado con `ajv` vía `validateAgainstSchema()`. Defensa en profundidad en dos capas, sin tocar `plugin-sdk-ts`: `ToolResolver.resolve()` (Gateway) rechaza args mal formados antes de despachar al Edge Agent, y `CapabilityRegistry.invoke()` (Edge Agent) los rechaza otra vez antes de resolver severidad o tocar el driver — son las dos fronteras de confianza reales (LLM↔Gateway, Gateway↔Edge Agent), no una capa intermedia en el SDK. Ver ADR-024 (`docs/00`) para el detalle y las alternativas descartadas.

## P2 — Autenticación y autorización por usuario — ✅ Implementado (2026-08-07, ADR-033)

**Problema (histórico).** Ya documentado extensamente en `docs/13` (C1) y `docs/15` (secciones 1-2): no existía el concepto de usuario. Era la brecha de seguridad más grande del sistema.

**Resuelto.** Ver `docs/19-arquitectura-auth-gateway-propuesta.md` (propuesta y estado final de los 5 incrementos) y ADR-033 (`docs/00`) para las decisiones de diseño tomadas al implementar — verificación de JWT con `getUser()`, pairing del Edge Agent vía código de un solo uso, dónde vive el chequeo de ownership (`Gateway.executeTool()`, no `TaskOrchestrator.submit()`, por los jobs programados), y auditoría por usuario.

**Prioridad:** alta, pero explícitamente **no bloqueante para seguir con ESP32 en un entorno de un solo usuario** — bloqueante solo para compartir el sistema con alguien más.

## P3 — Persistencia real para el estado del Gateway — ✅ Implementado, alcance parcial (2026-08-07, ADR-026)

**Problema (histórico).** `AgentRegistry`, `GlobalCapabilityRegistry` y `JsonlAuditStore` vivían en memoria/archivo local del proceso del Gateway. Un reinicio del Gateway pierde el registro de agentes (se reconstruye al reconectar, aceptable) pero el histórico de auditoría quedaba solo en ese archivo local, sin réplica ni backup.

**Resuelto (solo el Audit Store — la mitad "costo bajo" de la propuesta).** `AuditStorePort` → `SupabaseAuditStore` (`@kan/supabase-adapter`), tabla `audit_entries` (`supabase/migrations/0007_audit_entries.sql`). Al implementar apareció un obstáculo real no anticipado por la propuesta: `AuditStorePort` era síncrono (`append(): void`, `list(): AuditEntry[]`) y tuvo que volverse async para poder hacer network I/O de verdad — con blast radius mínimo porque `AuditService.record()` sigue sin esperar `append()` (best-effort, igual que antes). El Gateway usa la `service_role` key (primer uso en el proyecto) porque no tiene sesión de usuario; `audit_entries` tiene RLS activado pero sin ninguna policy para `anon`/`authenticated` — deny-by-default real. Ver ADR-026 (`docs/00`) para el detalle completo y las alternativas descartadas.

**Sigue pendiente:** `AgentRegistry`/`GlobalCapabilityRegistry` respaldados por Redis para multi-instancia — no se abordó en este incremento (sigue siendo la mitad "costo medio" de la propuesta original, sin caso de uso real todavía mientras el Gateway corra como un solo proceso).

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

## P7 — Streaming de respuestas del chat — ✅ Implementado, alcance parcial (2026-08-07, ADR-027)

**Problema (histórico).** `SendMessageUseCase.execute()` devolvía la conversación completa solo al terminar todas las rondas de tool-calling — con el simulador esto era casi instantáneo, pero en cuanto una capability real tarda segundos/minutos, el usuario se quedaba mirando "KAN está pensando…" sin ninguna señal de progreso intermedio.

**Resuelto (streaming a nivel de loop, no intra-capability).** `/api/chat` responde con SSE; `SendMessageUseCase.execute()` gana un callback opcional (`onEvent`) que emite `tool_call`/`tool_result`/`final` a medida que el loop ya existente los produce. **Corrección sobre la propuesta original:** el seam de `"progress"` que se asumía como "la pieza que falta del lado del Gateway" está vacío en los dos extremos — nadie lo emite nunca, ni el Edge Agent ni ningún plugin, y `TelemetryMessage` tampoco tiene un shape para progreso incremental. Construir eso de verdad (progreso *dentro* de una sola capability) habría exigido protocolo nuevo + cambios en cada plugin + `CapabilityRegistry`/`ToolExecutor`/`GatewayToolProvider`, muy por encima del costo estimado — se implementó en su lugar el streaming de eventos del loop, que sí es proporcional al costo original. `ToolProviderPort.executeTool()` sigue siendo una única espera bloqueante; la línea `if (message.status === "progress") return;` en `TaskOrchestrator` queda intacta, seam reservado y sin uso, ahora documentado como tal explícitamente.

**Hallazgo adicional, arreglado en el mismo incremento:** `TaskOrchestrator.TASK_TIMEOUT_MS` (15s) era menor que `plugin-gcode`'s `HOME_TIMEOUT_MS` (30s) — `home_axes`, el caso real de "operación de 30s+" que motivó este pedido, ya fallaba por timeout antes de completarse, sin relación con el streaming. Subidos en cadena: Gateway 40s, `GatewayToolProvider` 45s, `SendMessageUseCase` 90s. Ver ADR-027 (`docs/00`) para el detalle, el riesgo de duración de función serverless sin resolver, y la verificación manual realizada contra la API real de Gemini.

## P8 — `LoggerPort` para `gateway-core` (consistencia con `edge-agent-core`) — ✅ Implementado (2026-08-07, ADR-028)

**Problema (histórico).** `packages/edge-agent-core` tenía un `LoggerPort` propio con adaptador `FileAndConsoleLogger`, testeable y sustituible. `packages/gateway-core` usaba `console.log`/`console.error`/`console.warn` directo en `NoopScheduler`, `JsonlAuditStore`, `ConsoleNotificationService`, `NodeCronScheduler` y `apps/gateway/src/server.ts` — funcionaba, pero no era consistente con el patrón ya establecido, y no había forma de verificar qué se logueaba en un test.

**Resuelto.** `LoggerPort`/`LogLevel` se relocalizaron a `@kan/plugin-contract` (dueño neutral del que ya dependían ambos paquetes) en vez de que `gateway-core` importara el tipo desde `@kan/edge-agent-core` — acoplamiento cruzado entre dominios que no tenía otra razón de ser. `packages/edge-agent-core`'s `LoggerPort.ts` quedó como re-export, sin tocar sus ~10 consumidores internos. Nuevo adaptador `ConsoleLogger` (`packages/gateway-core/src/infra/`), deliberadamente sin el archivo local ni el bus que sí tiene sentido en `FileAndConsoleLogger` (nadie del lado del Gateway necesita logs en vivo en una UI, y ya persiste su audit trail aparte). Inyectado como último parámetro opcional con default en los 4 archivos que usaban `console.*`, sin romper ningún call site existente. Ver ADR-028 (`docs/00`) para el detalle y las alternativas descartadas.

---

## Resumen de prioridades

| # | Propuesta | Prioridad | Bloqueante para |
|---|---|---|---|
| P1 | Validación JSON Schema real | ✅ Implementado (ADR-024) | — |
| P2 | Auth/autorización por usuario | ✅ Implementado (ADR-033) | — |
| P3 | Persistencia real del Gateway | ✅ Implementado, alcance parcial (ADR-026) | Multi-instancia (Redis para Agent/Capability Registry) queda pendiente |
| P4 | Auditoría de invocaciones manuales | ✅ Implementado, alcance parcial (ADR-025) | Auditar confirmaciones manuales queda pendiente |
| P6 | Rate limiting | ✅ Implementado (ADR-025) | — |
| P7 | Streaming del chat | ✅ Implementado, alcance parcial (ADR-027) | Progreso real intra-capability queda pendiente |
| P5 | Multi-dispositivo / tareas compuestas | Baja | Un caso de uso real con >1 dispositivo del mismo tipo |
| P8 | `LoggerPort` compartido | ✅ Implementado (ADR-028) | — |
