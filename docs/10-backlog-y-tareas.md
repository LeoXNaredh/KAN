# Backlog y Primeras 50 Tareas

Metodología Scrum (según README): Epic → Feature → Story → Task/Subtask/Bug.

> **Estado real al cierre de v0.1** (ver `docs/09-roadmap.md` §0 para el detalle): **E1** (Core), **E2** (IA, con function-calling real), **E3** (Plugins), **E4** (Edge Agent), **E14** (Observabilidad — logging + tests, no Sentry todavía), **E15** (Seguridad — hardening de red/tokens, no firma de plugins todavía) están **completos o sustancialmente avanzados**. **E6** (Web) tiene el chat funcional pero no auth de usuario. **E9** (Escritorio) completo para el simulador. Nuevo epic no listado originalmente y ya completo: **Gateway** (`docs/12`) — el plano de control que resultó necesario antes de lo planeado. **E5** (Usuarios/Permisos por usuario, no por severidad — ese sí existe) sigue sin empezar, es la brecha de seguridad más importante identificada en `docs/15-seguridad-v0.1.md`. **E7** (ESP32/3D printing reales), **E8** (Memoria/RAG), **E10-E13**, **E16-E17** siguen sin empezar.

## 1. Epics del backlog completo

| # | Epic | Fase |
|---|---|---|
| E1 | Fundamentos del Core (dominio, casos de uso, puertos) | Fase 1 |
| E2 | Capa de Abstracción de IA | Fase 1 |
| E3 | Sistema de Plugins (contrato, SDK, ciclo de vida) | Fase 1 |
| E4 | Edge Agent (device manager, safety layer, cola offline) | Fase 1 |
| E5 | Gestión de Usuarios y Permisos | Fase 1 |
| E6 | Aplicación Web | Fase 1 |
| E7 | Plugins de dispositivo — lote 1 (ESP32/Arduino, 3D printing) | Fase 1 |
| E8 | Memoria y Contexto (RAG) | Fase 1-2 |
| E9 | Aplicación de Escritorio | Fase 1-2 |
| E10 | Aplicación Móvil | Fase 2 |
| E11 | Plugins de dispositivo — lote 2 (CNC/Láser, RPi, PLC) | Fase 2 |
| E12 | Plugins de procesamiento pesado (Visión, CAD, PCB) | Fase 2 |
| E13 | Plugins de integración (Telegram, WhatsApp, GitHub, Home Assistant) | Fase 2 |
| E14 | Observabilidad y Operaciones | Fase 1-2 |
| E15 | Seguridad y Cumplimiento (firma de plugins, auditoría) | Fase 1-2 |
| E16 | Marketplace de Plugins | Fase 2-3 |
| E17 | Multi-agente / Orquestación avanzada | Fase 2-3 |
| E18 | Documentación automática | Continuo |

## 2. Primeras 50 tareas priorizadas

Prioridad: **P0** (bloqueante, sin esto no hay MVP) · **P1** (crítico para el MVP) · **P2** (importante, puede ir justo después del MVP).

| # | Tarea | Epic | Prioridad | Depende de |
|---|---|---|---|---|
| 1 | Crear monorepo (Turborepo + pnpm workspaces) | E1 | P0 | — |
| 2 | Configurar `tsconfig`/`eslint` compartidos (`packages/config`) | E1 | P0 | 1 |
| 3 | Definir entidades de dominio: Conversation, Message, User, Device, Plugin, Permission, AgentTask | E1 | P0 | 1 |
| 4 | Definir puertos: `AIProviderPort`, `DevicePort`, `PluginPort` | E1 | P0 | 3 |
| 5 | Proyecto Supabase: esquema inicial + políticas RLS básicas | E1 | P0 | 3 |
| 6 | Repositorios de infraestructura (Supabase) implementando los puertos de persistencia | E1 | P0 | 4, 5 |
| 7 | Caso de uso: crear/continuar conversación | E1 | P0 | 6 |
| 8 | Caso de uso: enviar mensaje y recibir respuesta | E1 | P0 | 7 |
| 9 | `@kan/ai-abstraction`: interfaz `AIProviderPort` | E2 | P0 | 4 |
| 10 | Implementación del proveedor Gemini | E2 | P0 | 9 |
| 11 | Model Router (selección de proveedor + fallback básico) | E2 | P0 | 10 |
| 12 | Registro de uso/costo por proveedor (tokens) | E2 | P1 | 10 |
| 13 | Agent Orchestrator: versión mínima (sin tools) | E1 | P0 | 8, 11 |
| 14 | App Web: layout base + autenticación (Supabase Auth) | E6 | P0 | 5 |
| 15 | App Web: UI de chat conectada al Orchestrator | E6 | P0 | 13, 14 |
| 16 | `plugin-contract`: esquema de manifest (JSON Schema) | E3 | P0 | 4 |
| 17 | `@kan/plugin-sdk-ts`: clase base `KanPlugin` + decoradores de capability | E3 | P0 | 16 |
| 18 | Plugin Manager (Core Cloud): registro e instalación de plugins | E3 | P0 | 16, 6 |
| 19 | Function-calling: exponer capabilities instaladas como tools al LLM | E2/E3 | P0 | 11, 18 |
| 20 | Permission Manager: modelo de severidad de acciones (ADR-004) | E5 | P0 | 3 |
| 21 | Permission Manager: aprobación de usuario para permisos de plugin | E5 | P0 | 18, 20 |
| 22 | Task Coordinator: creación y ciclo de vida de `AgentTask` | E1 | P0 | 3, 20 |
| 23 | App Escritorio: bootstrap Electron (shell básico) | E9 | P0 | 1 |
| 24 | Edge Agent: conexión WebSocket persistente hacia Core Cloud (con auth) | E4 | P0 | 23, 22 |
| 25 | Edge Agent: Device Manager local (registro de dispositivos conectados) | E4 | P0 | 24 |
| 26 | Edge Agent: Plugin Runtime local (carga de plugins in-process) | E4 | P0 | 17, 25 |
| 27 | Edge Agent: Safety & Confirmation Layer (bloqueo por severidad + dry-run hook) | E4 | P0 | 20, 26 |
| 28 | Edge Agent: cola offline de comandos | E4 | P1 | 24 |
| 29 | Protocolo de mensajes Core↔Edge Agent (versión 1) | E4 | P0 | 24 |
| 30 | `plugin-esp32-arduino`: driver Serial/USB (listar puertos, enviar comando) | E7 | P0 | 17, 26 |
| 31 | Flujo E2E: "enciende el LED del ESP32" desde el chat web | E7 | P0 | 15, 19, 27, 29, 30 |
| 32 | Telemetría de progreso de tarea (Edge Agent → Core → Cliente vía Realtime) | E4/E6 | P0 | 29, 22 |
| 33 | Memory Manager: almacenamiento de hechos clave por usuario (sin embeddings aún) | E8 | P1 | 6 |
| 34 | Context Manager: estado de sesión (dispositivos conectados, plugin activo) | E1 | P1 | 25 |
| 35 | `plugin-3d-printing`: integración con OctoPrint API | E7 | P1 | 17, 26 |
| 36 | Dry-run/preview para acciones `irreversible-material` (interfaz genérica) | E4 | P1 | 27 |
| 37 | UI web: pantalla de instalación de plugin (permisos en lenguaje natural) | E6/E3 | P1 | 18, 21 |
| 38 | UI web: panel de dispositivos (estado, conexión) | E6/E4 | P1 | 32 |
| 39 | Manejo de errores end-to-end (plugin falla → estado consistente en Core y cliente) | E1/E4 | P1 | 31 |
| 40 | Setup CI (GitHub Actions): lint + test + typecheck en cada PR | E14 | P0 | 1 |
| 41 | Setup CD: deploy automático de web a Vercel en merge a main | E14 | P1 | 40 |
| 42 | Firma de manifest de plugin (mecanismo criptográfico, aunque marketplace no exista aún) | E15 | P1 | 16 |
| 43 | Logging estructurado (Core Cloud + Edge Agent) | E14 | P1 | 24 |
| 44 | Integración Sentry (errores en Web, Core, Edge Agent) | E14 | P2 | 43 |
| 45 | Memory Manager: embeddings (pgvector) + recuperación relevante (RAG básico) | E8 | P2 | 33 |
| 46 | Multi-turno robusto: resumen automático de conversaciones largas | E1/E8 | P2 | 45 |
| 47 | Documentación autogenerada de API (a partir de los puertos/casos de uso) | E18 | P2 | 13 |
| 48 | Plantilla `_template` para nuevos plugins (TS) | E3 | P2 | 17 |
| 49 | Suite de pruebas de la Safety Layer (casos límite: pérdida de conexión mid-task, doble confirmación) | E4/E15 | P1 | 27, 36 |
| 50 | Demo interna end-to-end + checklist de salida de Fase 1 | — | P0 | 31, 35, 39 |

## 3. Notas sobre esta lista

- El **plugin Python sidecar** (visión, CAD) queda fuera de las primeras 50 a propósito: introducir el runtime out-of-process (ADR-003) es una pieza grande que se aborda una vez que el patrón in-process (30-31) ya está probado en producción — no simultáneamente.
- La tarea **49 (suite de pruebas de la Safety Layer)** está deliberadamente en el top 50, no en "deuda técnica para después": es la pieza que protege a personas y equipos, no un nice-to-have.
