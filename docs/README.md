# Documentación de KAN

Análisis arquitectónico completo derivado del [KAN Master Prompt](../README.md). Empezó como "Primera Tarea" (solo decisiones, sin código) y hoy documenta un sistema real: chat con function-calling, Gateway, Edge Agent y un Device Simulator funcionando end-to-end (**Milestone v0.1**, ver [CHANGELOG.md](../CHANGELOG.md) y [RELEASE_NOTES_v0.1.md](../RELEASE_NOTES_v0.1.md)).

**Empieza aquí:** [00-analisis-y-decisiones.md](00-analisis-y-decisiones.md) — resumen de la visión, qué se cuestiona del planteamiento original y por qué (incluye los ADRs). Para el estado real del sistema hoy, empieza por [13-auditoria-v0.1.md](13-auditoria-v0.1.md).

## Índice

| Doc | Contenido |
|---|---|
| [00 — Análisis y Decisiones (ADRs)](00-analisis-y-decisiones.md) | Fortalezas de la visión, puntos cuestionados, 8 ADRs, recortes de alcance del MVP |
| [01 — Arquitectura General](01-arquitectura-general.md) | Vista de alto nivel, diagrama, capas Clean Architecture, los tres planos del sistema |
| [02 — Estructura de Carpetas](02-estructura-carpetas.md) | Layout completo del monorepo |
| [03 — Arquitectura del Core](03-arquitectura-core.md) | Los 10 módulos del Core y sus responsabilidades |
| [04 — Arquitectura de Plugins](04-arquitectura-plugins.md) | Tipos de plugin, manifest, ciclo de vida, SDK |
| [05 — Arquitectura de IA](05-arquitectura-ia.md) | Abstracción de proveedores, orquestación de agentes, memoria/RAG |
| [06 — Arquitectura de Dispositivos](06-arquitectura-dispositivos.md) | Edge Agent, protocolos por dispositivo, descubrimiento |
| [07 — Arquitectura de Comunicación](07-arquitectura-comunicacion.md) | Matriz de comunicación, flujo end-to-end, formato de mensajes |
| [08 — Tecnologías](08-tecnologias.md) | Stack recomendado, alternativas, notas de free tier |
| [09 — Roadmap](09-roadmap.md) | Mes 1 (MVP) semana a semana, 6 meses, estrategia a 5 años |
| [10 — Backlog y primeras 50 tareas](10-backlog-y-tareas.md) | 18 epics + tabla priorizada de 50 tareas |
| [11 — Riesgos](11-riesgos.md) | Técnicos, de negocio y legales — con foco en seguridad física |
| [12 — Arquitectura del Gateway](12-arquitectura-gateway.md) | Los 10 módulos del plano de control: Connection Manager, Agent Registry, Capability Registry, Task Orchestrator, Function Calling Engine, Audit Service, Event Bus, Scheduler, Notification Service, API Pública |
| [13 — Auditoría v0.1](13-auditoria-v0.1.md) | Deuda técnica, duplicación, acoplamientos, memory leaks, race conditions, arquitectura, seguridad y performance — con severidad y prioridad de fix |
| [14 — Performance v0.1](14-performance-v0.1.md) | Latencias medidas en vivo, tiempo de conexión del Edge Agent, memoria, Event Bus, cuellos de botella y qué no se midió |
| [15 — Seguridad v0.1](15-seguridad-v0.1.md) | Auth, autorización, validación de entradas, serialización, WebSockets, tokens, logs, auditoría, escenarios de ataque |
| [16 — Propuestas de Arquitectura v0.1](16-arquitectura-propuestas-v0.1.md) | Mejoras identificadas al cierre de v0.1 (P1-P8) — validación de `inputSchema`, auth por usuario en el Gateway, persistencia real, auditoría de invocaciones manuales, rate limiting, streaming del chat, `LoggerPort` compartido |
| [17 — Plan de implementación v0.2](17-plan-implementacion-v0.2.md) | Repriorización de "UX visible" a "inteligencia real" (P0-P8), ADRs de voz/memoria/identidad, mapeo por funcionalidad |
| [18 — Propuesta de Arquitectura Móvil](18-arquitectura-movil-propuesta.md) | Cliente React Native/Expo (roadmap P7): conectividad con el Gateway/IA, sesión de Supabase sin cookies, streaming SSE, paridad de UI, voz/imagen nativas |

## La decisión más importante de todo el documento

Si solo lees una cosa: el **Edge Agent** (ADR-001, doc 00). Next.js/Vercel no puede controlar hardware físico directamente — se introduce un proceso local que hace de puente seguro entre el Core en la nube y los dispositivos del usuario. Esta decisión condiciona casi todo lo demás (estructura de carpetas, elección de Electron, el modelo de comunicación, y la propia Safety Layer que protege contra acciones físicas irreversibles).
