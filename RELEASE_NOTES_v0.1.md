# KAN — Release Notes v0.1

**Fecha:** 2026-08-06
**Estado:** Milestone de estabilización cerrado. Base sólida y mantenible para construir el primer dispositivo físico real (ESP32) a continuación — no una release para usuarios finales.

## Qué es esta release

La primera vez que el ciclo completo de la visión de KAN funciona de punta a punta: escribes en el chat, un LLM (Gemini) decide qué herramienta usar, el sistema la ejecuta contra un dispositivo real (hoy simulado) a través de una arquitectura de plano de control con permisos de seguridad, y la respuesta vuelve al chat — todo sobre una base auditada, con tests, sin deuda técnica escondida.

## Qué funciona

- **Chat con Gemini**, con historial de conversación persistente durante la sesión del servidor.
- **Function-calling real**: el LLM propone invocar herramientas (nunca las ejecuta él mismo); el sistema resuelve, ejecuta y le devuelve el resultado para que continúe la conversación con contexto real. Visible en la UI del chat — se ve qué herramienta se llamó y qué devolvió.
- **Gateway** (`apps/gateway`): plano de control real con 10 módulos diseñados (`docs/12-arquitectura-gateway.md`) — Connection Manager, Agent Registry, Global Capability Registry, Task Orchestrator, Function Calling Engine, Audit Service y Event Bus completamente implementados; Scheduler y Notification Service como seams documentados, listos para cuando exista un caso de uso real.
- **Edge Agent** (`apps/desktop`, Electron): descubre dispositivos, gestiona plugins, aplica la Safety Layer (ADR-004) — acciones `read-only`/`reversible` se ejecutan directo, `irreversible-material`/`safety-critical` requieren confirmación explícita del usuario en la propia app, nunca desde el chat remoto.
- **Device Simulator**: un dispositivo que se comporta exactamente como uno real (mismo `DeviceDriverPort` que usarán ESP32/CNC/impresoras), con 3 capabilities de severidad distinta — probado el flujo de confirmación de extremo a extremo, incluyendo rechazo.
- **102 tests automatizados** en 9 paquetes, incluyendo pruebas de red reales (clientes WebSocket de verdad contra `WsConnectionManager`, no mocks) y el loop completo de tool-calling.
- **Lint y typecheck limpios** en todo el monorepo (10 paquetes), sin una sola advertencia.
- **Auditoría de seguridad formal**, con hardening real aplicado: límite de tamaño de mensaje WebSocket, comparación de tokens en tiempo constante, protección contra conexiones duplicadas/zombie, validación de forma de mensajes.

## Qué NO funciona todavía (limitaciones conocidas, no bugs escondidos)

- **Ningún dispositivo físico real.** El Device Simulator es el único "dispositivo" — ESP32, Arduino, CNC, láser, impresoras 3D, robots: nada de eso existe todavía. Es explícitamente el siguiente paso, no algo que esta release pretenda cubrir.
- **Sin autenticación de usuario.** `apps/web` y el Gateway usan tokens compartidos, no login. Cualquiera con acceso a la máquina/red donde corre puede usar el sistema. Aceptable para desarrollo local de un solo usuario; **bloqueante** antes de compartir esto con alguien más o exponerlo fuera de `localhost`.
- **Sin persistencia real.** Las conversaciones viven en memoria del proceso de `apps/web` — se pierden al reiniciar el servidor. Supabase está en el roadmap (ADR-007), no implementado todavía; el puerto (`ConversationRepositoryPort`) ya está listo para el swap.
- **Sin memoria de largo plazo ni RAG.** El chat no recuerda nada entre conversaciones distintas.
- **Un solo proveedor de IA activo** (Gemini). La abstracción para Claude/GPT/local existe (`AIProviderPort`), pero `ModelRouter` no tiene todavía un segundo proveedor real al que hacer fallback.
- **Auditoría incompleta**: acciones disparadas manualmente desde la UI del Edge Agent (no desde el chat) no llegan al `audit.jsonl` del Gateway — quedan solo en el log local de esa máquina.
- **Sin app móvil, sin Sentry/observabilidad externa, sin CI/CD, sin marketplace de plugins.** Todo esto sigue en el roadmap de Fase 2 (`docs/09-roadmap.md`), sin cambios.
- **`inputSchema` de las capabilities no se valida formalmente contra JSON Schema** — cada plugin valida su propio input a mano (el simulador ya lo hace correctamente tras esta release). Aceptable con un plugin de juguete; **debe resolverse antes del primer plugin de hardware real** con consecuencias físicas de verdad.

## Documentos de referencia de esta release

- [`docs/13-auditoria-v0.1.md`](docs/13-auditoria-v0.1.md) — auditoría completa (calidad, arquitectura, concurrencia, performance, seguridad), con cada hallazgo priorizado.
- [`docs/14-performance-v0.1.md`](docs/14-performance-v0.1.md) — latencias medidas en vivo, memoria, cuellos de botella.
- [`docs/15-seguridad-v0.1.md`](docs/15-seguridad-v0.1.md) — reporte de seguridad formal por categoría (auth, autorización, validación, WebSockets, tokens, logs, auditoría, ataques).
- [`docs/16-arquitectura-propuestas-v0.1.md`](docs/16-arquitectura-propuestas-v0.1.md) — propuestas de mejora arquitectónica identificadas, documentadas pero no implementadas.
- [`CHANGELOG.md`](CHANGELOG.md) — registro de cambios de esta release.

## Siguiente roadmap

1. **`plugin-esp32-arduino`** — el primer dispositivo físico real, reutilizando exactamente la infraestructura validada con el simulador (Plugin Manager, Device Manager, Permission Manager, Capability Registry sin cambios).
2. Antes de ese plugin: **validación real de `inputSchema`** (JSON Schema), porque un input mal formado contra hardware real tiene consecuencias que un simulador no tiene.
3. **Autenticación de usuario** (Supabase Auth) — condición para cualquier uso más allá de un solo desarrollador en su propia máquina.
4. **Auditoría completa** de invocaciones manuales del Edge Agent hacia el Gateway.
5. Después: `plugin-cnc-laser`, `plugin-3d-printing` (vía OctoPrint), y el resto del roadmap de Fase 2 sin cambios respecto a lo ya documentado.

## Cómo correr esto hoy

1. `pnpm install` en la raíz.
2. `apps/gateway`: copiar `.env.example` a `.env`, `pnpm --filter gateway dev`.
3. `apps/desktop`: `pnpm --filter desktop dev` (se conecta al Gateway automáticamente con los defaults de desarrollo).
4. `apps/web`: copiar `.env.example` a `.env.local`, agregar tu `GEMINI_API_KEY` (gratis en https://aistudio.google.com/apikey), `pnpm --filter web dev`.
5. Abrir `http://localhost:3000`, escribir algo como "lee el sensor del simulador".

Verificación de calidad antes de cualquier cambio nuevo: `pnpm turbo run lint typecheck test` desde la raíz — debe quedar limpio.
