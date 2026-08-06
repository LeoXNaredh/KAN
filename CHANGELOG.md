# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/). Este proyecto todavía no sigue versionado semántico estricto (pre-1.0), pero las entradas se agrupan por release.

## [0.1.0] — Milestone v0.1 — 2026-08-06

Primera release estable de KAN: el loop completo **Chat → Gateway → Edge Agent → Dispositivo (simulado) → Chat** funciona de punta a punta, con function-calling real contra Gemini, y una auditoría formal de estabilización (código, seguridad, performance) antes de tocar hardware real.

### Added

- **Monorepo** (Turborepo + pnpm workspaces), documentación arquitectónica completa (`docs/00`–`docs/12`): análisis del CTO con 8 ADRs iniciales, arquitectura general, estructura de carpetas, arquitectura del Core/Plugins/IA/Dispositivos/Comunicación, tecnologías, roadmap, backlog priorizado, riesgos.
- **`packages/core`**: dominio (`Conversation`, `Message`), puertos (`AIProviderPort`, `ConversationRepositoryPort`, `ToolProviderPort`), `SendMessageUseCase` — el Agent Orchestrator con loop de function-calling (máximo 4 rondas, límite de 45s de duración total).
- **`packages/ai-abstraction`**: `GeminiProvider` (chat + function-calling real contra la API de Gemini) y `ModelRouter`.
- **`packages/plugin-contract`**: vocabulario neutral compartido — severidad de acciones (ADR-004), `CapabilityDescriptor`, `DeviceDriverPort`, `PluginManifest`, protocolo Core↔Edge Agent, `ToolDescriptor`/`ToolCallProposal`/`ToolExecutionResult`, comparación de tokens en tiempo constante.
- **`packages/plugin-sdk-ts`**: `KanPlugin`/`KanDeviceDriverPlugin` — base para plugins de dispositivo.
- **`packages/edge-agent-core`**: Plugin Manager, Device Manager, Permission Manager (aplica ADR-004, con expiración TTL de confirmaciones ignoradas), Capability Registry, Event Bus interno, Config Store, Logger, `CoreWebSocketClient` (reconexión con backoff + jitter).
- **`plugins/plugin-device-simulator`**: el primer dispositivo — 3 capabilities de severidad distinta (`read_sensor`, `toggle_led`, `move_axis`) para ejercitar toda la Safety Layer sin hardware real.
- **`apps/desktop`**: aplicación Electron que hospeda el Edge Agent, con UI de validación (dispositivos, capabilities, modal de confirmación ADR-004, logs en vivo, estado de conexión al Core).
- **`apps/web`**: chat Next.js con historial de conversación y, desde el incremento del Gateway, function-calling visible (qué herramienta se llamó y qué devolvió).
- **`packages/gateway-core` + `apps/gateway`** — el plano de control (`docs/12-arquitectura-gateway.md`): Connection Manager (WebSocket real, autenticado, con protección contra `hello` duplicado y colisión de `edgeAgentId`), Agent Registry, Global Capability Registry, Task Orchestrator, Function Calling Engine (`ToolRegistry`/`ToolResolver`/`ToolExecutor` — el LLM solo propone, nunca ejecuta), Audit Service (JSONL, escritura asíncrona), Event Bus, y los seams documentados para Scheduler/Notification Service.
- **Infraestructura de calidad**: ESLint 9 (flat config compartida) y Vitest en los 9 paquetes con lógica no trivial — **102 tests** cubriendo unit, integration, y los límites de red reales (Gateway Tests con clientes WebSocket reales, Edge Agent Tests, Plugin/Simulator Tests).
- **Auditoría formal de estabilización** (`docs/13-auditoria-v0.1.md`, `docs/14-performance-v0.1.md`, `docs/15-seguridad-v0.1.md`): 3 revisiones independientes (calidad/arquitectura, concurrencia/performance, seguridad) antes de aplicar ningún fix.

### Fixed (hallazgos de la auditoría de estabilización)

- Validación real de input en `plugin-device-simulator` — corrige un bug donde `Boolean("false")` se evaluaba `true` (invertía el LED sin error) y otro donde un `distanceMm` no numérico corrompía el estado con `NaN` permanentemente.
- Memory leak en `TaskOrchestrator.tasks` (crecía sin límite) — ahora con retención acotada de 5 minutos tras resolverse.
- Confirmaciones de `PermissionManager` que se ignoraban quedaban huérfanas para siempre — ahora expiran a los 10 minutos, tratadas como rechazo.
- `WsConnectionManager` sin límite de tamaño de mensaje (hasta 100MB por defecto) — ahora `maxPayload: 64KB`.
- `WsConnectionManager` no protegía contra un segundo `hello` en la misma conexión ni contra dos conexiones reclamando el mismo `edgeAgentId` (conexión zombie) — ahora ambos casos se manejan explícitamente y están probados con clientes WebSocket reales.
- Comparación de tokens con `!==` (no constant-time) — reemplazada por `crypto.timingSafeEqual` en el handshake WS y en las rutas HTTP del Gateway.
- Escritura de auditoría síncrona (`appendFileSync`) bloqueaba el único hilo del Gateway en cada ejecución de tool — ahora asíncrona, con lectura servida desde memoria (también resuelve una relectura completa del archivo en cada `GET /v1/audit`).
- `fetch()` del Gateway desde `apps/web` sin timeout podía colgar el chat indefinidamente si el Gateway aceptaba la conexión pero no respondía — ahora con `AbortSignal.timeout`.
- `SendMessageUseCase` sin límite de duración total del loop de tool-calling — ahora acotado a 45s, evitando acercarse a límites de función serverless.
- `DeviceManager.discoverAll()` descubría dispositivos de múltiples drivers de forma secuencial — ahora en paralelo entre drivers.
- Race condition en `apps/desktop`: la ventana podía cargar antes de que los handlers IPC estuvieran registrados — ahora los handlers se registran primero.
- Errores de `invokeCapability` se descartaban en silencio en la UI del Edge Agent — ahora se muestran en el panel de logs.
- `apps/gateway` solo manejaba `SIGINT` — ahora también `SIGTERM`, `uncaughtException` y `unhandledRejection`.
- Puertos de conexión (`ConnectionManagerPort`, `CoreConnectionPort`) sin capacidad de des-suscripción — ahora cada `on*` devuelve una función de unsubscribe (necesario para testing y para evitar handlers fantasma).

### Known limitations (ver `RELEASE_NOTES_v0.1.md` para el detalle completo)

- Sin autenticación de usuario en `apps/web` ni en el Gateway (solo tokens compartidos) — aceptable para uso local de un solo usuario, bloqueante para cualquier despliegue compartido.
- Persistencia de conversaciones en memoria (no Supabase todavía) — decisión consciente (ADR-007), no descuido.
- Auditoría del Gateway no captura invocaciones manuales hechas directo desde la UI del Edge Agent (quedan en el log local, no en `audit.jsonl`).
- `ModelRouter` no tiene fallback real todavía (un solo proveedor configurado).
- Sin dispositivos físicos reales — el único "dispositivo" es el Device Simulator.

> Este repositorio todavía no tiene remoto de GitHub configurado (solo git local) — cuando se agregue, este archivo puede enlazar cada versión a su rango de commits.
