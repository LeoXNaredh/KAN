# Roadmap

## 0. Estado real al cierre del Milestone v0.1

El plan original de abajo se seguía de forma aproximada, no literal — decisiones tomadas en el camino (con el usuario) lo desviaron deliberadamente en dos puntos:

1. **El primer dispositivo fue un Device Simulator, no un ESP32.** Decisión explícita del usuario antes de construir el Edge Agent: validar toda la infraestructura (Plugin Manager, Device Manager, Capability Registry, Permission Manager, Safety Layer) contra un dispositivo simulado primero, para que ESP32/CNC/impresoras reutilicen la misma base sin haber pagado el costo de descubrir problemas de arquitectura contra hardware real. El hito "KAN enciende el LED" de la Semana 3 se cumplió, pero contra el simulador — **el ESP32 real sigue pendiente**, es el siguiente incremento después de este milestone de estabilización.
2. **El Gateway (originalmente repartido en Fase 2, mes 6 — "Planner multi-agente", "modelo de firma de paquetes") se construyó completo y antes de tiempo**, como plano de control formal con sus 10 módulos (`docs/12-arquitectura-gateway.md`), porque resultó ser el bloqueador real para que el chat pudiera controlar cualquier dispositivo — no tenía sentido posponerlo a un "Mes 6" cuando era condición para que el MVP mismo funcionara de punta a punta.

**Completado (verificado con tests + typecheck + lint limpios, `docs/13`):**
- ✅ Semana 1 completa (monorepo, `@kan/ai-abstraction` con Gemini, chat funcional).
- ✅ Semana 2 completa (`plugin-contract`, `plugin-sdk-ts`, Edge Agent, Permission Manager/ADR-004, function-calling) — function-calling real contra Gemini, no solo diseñado.
- ✅ Semana 3 — pero con el Simulador en vez de ESP32: Safety & Confirmation Layer probada end-to-end, flujo completo desde el chat validado en vivo.
- ✅ Adelantado de Fase 2/Mes 6: Gateway completo (Connection Manager, Agent Registry, Capability Registry, Task Orchestrator, Function Calling Engine, Audit Service, Event Bus; Scheduler/Notification Service como seams documentados).
- ✅ **Milestone adicional no planeado originalmente**: estabilización formal v0.1 completa (auditoría, 102 tests, hardening de seguridad/concurrencia, performance, documentación) — `docs/13`, `docs/14`, `docs/15`, `CHANGELOG.md`, `RELEASE_NOTES_v0.1.md`.

**Pendiente de la Fase 1 original:**
- ❌ `plugin-esp32-arduino` real (Semana 3) — siguiente hito inmediato tras este milestone.
- ❌ `plugin-3d-printing`/OctoPrint (Semana 4).
- ❌ Persistencia real (Supabase) — sigue en memoria (ADR-007), decisión consciente, no descuido.
- ❌ Memory Manager / RAG (mencionado en Semana 3 como "versión mínima") — no se abordó; `SendMessageUseCase` no tiene memoria de largo plazo todavía.

## 1. Criterio para el MVP

El MVP debe demostrar el **loop completo**: lenguaje natural → decisión del Core → acción física real → confirmación de seguridad → resultado visible. Un MVP que solo "chatea bien" no prueba nada distinto a un chatbot; un MVP que controla hardware sin capa de seguridad es irresponsable. El MVP tiene que probar ambas cosas con **un solo dispositivo real end-to-end**, no cinco a medias.

**Dispositivo elegido para el MVP: ESP32/Arduino** (no impresora 3D ni CNC). Razón: es el más barato y rápido de tener en un banco de pruebas, sus acciones son mayormente `reversible` (encender/apagar un LED, leer un sensor), lo que permite probar todo el flujo — incluida la Safety Layer — sin el riesgo de una primera prueba real siendo "cortar material con láser". CNC/Láser/Impresión 3D entran en cuanto el loop base esté probado (semana 3-4).

## 2. FASE 1 — Primer mes (MVP)

### Semana 1 — Cimientos
| Tarea | Prioridad | Dependencias | Riesgo |
|---|---|---|---|
| Setup monorepo (Turborepo, pnpm, `packages/core` esqueleto) | Crítica | — | Bajo |
| Supabase: esquema inicial (users, conversations, messages, devices, plugins, permissions) | Crítica | Monorepo | Bajo |
| `@kan/ai-abstraction`: puerto + implementación Gemini | Crítica | Monorepo | Medio (API key, cuotas) |
| Conversation Manager + Agent Orchestrator (versión mínima, sin tools aún) | Crítica | AI abstraction | Medio |
| Web app: chat básico funcional (sin dispositivos) | Alta | Orchestrator | Bajo |

### Semana 2 — Plugins y Edge Agent
| Tarea | Prioridad | Dependencias | Riesgo |
|---|---|---|---|
| `plugin-contract` (manifest schema) + `@kan/plugin-sdk-ts` | Crítica | Core esqueleto | Medio |
| Edge Agent mínimo (Electron shell + Device Manager local + conexión WS al Core) | Crítica | plugin-contract | **Alto** (primer punto de integración real Cloud↔Local) |
| Permission Manager: modelo de severidad de acciones (ADR-004) | Crítica | Core esqueleto | Medio |
| Function-calling: exponer capabilities de plugins instalados como tools al LLM | Crítica | AI abstraction, plugin-contract | Alto |

### Semana 3 — Primer dispositivo real
| Tarea | Prioridad | Dependencias | Riesgo |
|---|---|---|---|
| `plugin-esp32-arduino` (driver Serial/USB) | Crítica | Edge Agent, plugin SDK | Medio |
| Safety & Confirmation Layer funcionando end-to-end (aunque ESP32 sea mayormente reversible, se prueba el mecanismo completo) | Crítica | Permission Manager, Edge Agent | Alto |
| Flujo completo: "KAN enciende el LED del ESP32" desde el chat web | Crítica | Todo lo anterior | Alto — **este es el hito que valida la arquitectura** |
| Memory Manager (versión mínima: hechos clave por usuario) | Media | Core esqueleto | Bajo |

### Semana 4 — Pulido y segundo dispositivo
| Tarea | Prioridad | Dependencias | Riesgo |
|---|---|---|---|
| `plugin-3d-printing` (integración con OctoPrint API — no reinventar) | Alta | Edge Agent | Medio |
| Dry-run/preview para acciones `irreversible-material` | Alta | Safety Layer | Medio |
| Persistencia de conversación multi-turno robusta + Realtime en cliente | Alta | Conversation Manager | Bajo |
| Demo interna end-to-end + hardening de bugs críticos | Crítica | Todo | — |

**Riesgo transversal de la Fase 1:** el Edge Agent y el canal Core↔Edge son la pieza más nueva y con más incertidumbre técnica (nadie la ha construido antes en este proyecto). Se prioriza deliberadamente en la semana 2, no al final, para descubrir problemas de arquitectura mientras aún hay tiempo de reaccionar.

## 3. FASE 2 — Primeros seis meses

| Mes | Objetivo principal | Entregables clave |
|---|---|---|
| Mes 2 | Estabilizar el Core y ampliar dispositivos "fáciles" | `plugin-raspberry-pi`, `plugin-home-assistant`, mejoras de Memory (RAG completo), telemetría/observabilidad (Sentry) |
| Mes 3 | Dispositivos de mayor riesgo físico | `plugin-cnc-laser` con dry-run real (simulación de G-code), pruebas de seguridad exhaustivas, auditoría de la Safety Layer |
| Mes 4 | App móvil y de escritorio a paridad | React Native a paridad funcional con web; Electron con empaquetado/firma para distribución real |
| Mes 5 | Plugins de procesamiento pesado | `plugin-vision` (sidecar Python), `plugin-cad` (generación asistida de modelos), infraestructura de sidecars (Docker) |
| Mes 6 | Fundamentos del marketplace + multi-agente | Modelo de firma de paquetes operativo (aunque el marketplace público no abra aún), primer Planner multi-agente para tareas compuestas, plugins de mensajería (Telegram/WhatsApp) como canal de entrada alternativo al chat web |

## 4. Estrategia de 5 años (crecer sin reescritura completa)

La razón por la que esto es alcanzable sin reescritura es que las fronteras se fijan ahora (Core/Plugin, Cloud/Edge, dominio/infraestructura) y todo lo que crece después lo hace **añadiendo plugins y adaptadores**, no modificando el núcleo:

- **Año 1**: MVP → plataforma estable, Fase 2 completa. Base de usuarios early adopters (makers, hobbyistas, laboratorios pequeños).
- **Año 2**: Apertura del marketplace público de plugins (el modelo de permisos ya existe desde el Año 1 — ADR-008 — así que esto es "abrir la puerta", no "construir la cerradura"). Programa de verificación de plugins de terceros.
- **Año 3**: Casos de uso empresariales/industriales (PLC, fábricas pequeñas) — requiere capa adicional de compliance/auditoría, pero se apoya en el mismo Permission Manager y Safety Layer, extendidos, no reemplazados.
- **Año 4**: Multi-agente maduro (varios "especialistas" colaborando en tareas complejas de principio a fin: diseño → fabricación → control de calidad por visión artificial), aprovechando la interfaz `Agent` definida desde Fase 2.
- **Año 5**: KAN como *ecosistema* — desarrolladores externos construyen negocios sobre plugins de KAN, posible modelo de ingresos por marketplace (revenue share) y por tier empresarial on-prem para quienes no puedan depender de la nube (requisitos de seguridad industrial).

El principio que sostiene los 5 años: **cada capacidad nueva es un plugin nuevo o un adaptador nuevo detrás de un puerto existente.** El día que una funcionalidad nueva "necesite" tocar el Core es una señal de alarma arquitectónica, no una excepción aceptable — y es exactamente el tipo de cosa que, como arquitecto, te voy a señalar cuando ocurra.
