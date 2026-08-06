# Documentación de KAN

Análisis arquitectónico completo derivado del [KAN Master Prompt](../README.md), como "Primera Tarea" solicitada: sin código, solo decisiones.

**Empieza aquí:** [00-analisis-y-decisiones.md](00-analisis-y-decisiones.md) — resumen de la visión, qué se cuestiona del planteamiento original y por qué (incluye los ADRs).

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

## La decisión más importante de todo el documento

Si solo lees una cosa: el **Edge Agent** (ADR-001, doc 00). Next.js/Vercel no puede controlar hardware físico directamente — se introduce un proceso local que hace de puente seguro entre el Core en la nube y los dispositivos del usuario. Esta decisión condiciona casi todo lo demás (estructura de carpetas, elección de Electron, el modelo de comunicación, y la propia Safety Layer que protege contra acciones físicas irreversibles).
