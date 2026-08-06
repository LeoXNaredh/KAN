# Plan de implementación v0.2 — Línea A / Línea B

> Compañero técnico de [`VISION_PRODUCT_v0.2.md`](../VISION_PRODUCT_v0.2.md). Ese documento dice *qué* y *por qué*; este dice *cómo*, con qué paquetes, en qué orden, y qué decisiones de arquitectura hacen falta antes de escribir código.

---

## 0. Repriorización 2026-08-06 — de "UX visible" a "inteligencia real"

Tras cerrar el Dashboard v0.2 (`6b96bfd`) y el Design System v1 (`f0b0129`), el usuario decidió que la base visual ya es suficiente por ahora y redefinió el orden de prioridades: **el criterio deja de ser "qué se ve más rápido" y pasa a ser "qué acerca más a KAN a un asistente real tipo Jarvis"**, con foco explícito en construir "lento pero correctamente" — sin rehacer arquitectura más adelante. El orden de incrementos del §4 original (abajo, conservado como referencia histórica) queda **superseded** por esta lista:

| Prioridad | Contenido |
|---|---|
| **P0** | Supabase Auth, perfiles de usuario, configuración por usuario, memoria persistente |
| P1 | Voz (Push-to-Talk), Speech-to-Text, Text-to-Speech, personalidad configurable, conversaciones naturales |
| P2 | Memoria de largo plazo, contexto entre conversaciones, preferencias del usuario, aprendizaje de dispositivos, planificación de tareas |
| P3 | Visión: cámara, análisis de imágenes, OCR, lectura de documentos, reconocimiento de dispositivos |
| P4 | Dashboard inteligente: widgets, estado de dispositivos, actividad, automatizaciones, notificaciones |
| P5 | Hardware: ESP32, Arduino, impresoras 3D, CNC, láser, robots, PLC, MQTT, Modbus, ROS2 |
| P6 | Automatizaciones: workflows, agentes, planner, scheduler, eventos, reglas |
| P7 | Apps móviles: Android, iOS, PWA, notificaciones push |
| P8 | Marketplace de plugins: SDK, API pública, documentación |

**Efecto directo sobre las secciones de abajo:**
- **ADR-016** ("identidad mínima separada de Auth completo") queda **superseded**: P0 va directo a Auth completo de Supabase, no a un `userId` mínimo como paso intermedio — el usuario prefiere construir la pieza correcta una vez en vez de una versión mínima que luego se reemplaza. Se conserva en §2 como registro histórico de la decisión anterior, no como plan vigente.
- **ADR-015** (Memoria estructurada antes que RAG) sigue vigente — P0 incluye "memoria persistente" y P2 "memoria de largo plazo", coherente con la secuencia ya propuesta (estructurada primero, RAG después si aparece un caso de uso real).
- **ADR-014** (`VoiceProviderPort` por fases) sigue vigente — ahora es P1, no #6 de una lista de 10.
- Todo lo de §3 (mapeo por funcionalidad) sigue siendo información técnica válida — la referencia cruzada por P-tier reemplaza al orden secuencial de §4, que queda como archivo histórico, no como plan activo.

---

## 1. Principio de no-ruptura

Ninguna pieza de este plan modifica el contrato de lo ya construido y probado (`plugin-contract`, `DeviceDriverPort`, `AIProviderPort`, el protocolo Core↔Edge Agent, el modelo de severidad ADR-004). Todo lo nuevo entra como:

- **Puertos nuevos** (`VoiceProviderPort`, `MemoryStorePort`, `NotificationServicePort`/`SchedulerPort` reales en vez de stubs) — mismo patrón hexagonal ya validado.
- **Extensiones opcionales** de tipos existentes (`Message` con contenido multimodal, `ChatRequest` con imágenes) — nunca campos que rompan a un consumidor que no los use, siguiendo el mismo patrón que `CapabilityDescriptor.targetParam?` (opcional, retrocompatible) del incremento anterior.
- **Paquetes/apps nuevos** cuando la responsabilidad es genuinamente distinta (ej. un paquete de voz), nunca lógica nueva metida a la fuerza en un paquete existente.

Si en algún punto de la ejecución real una pieza de la Línea B "necesita" romper un contrato del Core, eso se trae de vuelta a discusión antes de hacerlo — es la señal de alarma que el propio roadmap técnico (`docs/09-roadmap.md` §4) ya identificó como línea roja.

---

## 2. ADRs nuevos propuestos (pendientes de aprobación — no se agregan a `docs/00` hasta confirmarlos)

### ADR-014 (propuesto): `VoiceProviderPort` desacoplado, con voz por fases

**Decisión propuesta:** un puerto `VoiceProviderPort` en un paquete nuevo `@kan/voice-abstraction` (mismo rol que `@kan/ai-abstraction` para texto), con dos capacidades separadas desde el diseño:

```ts
interface VoiceProviderPort {
  transcribe(audio: AudioInput): Promise<string>;       // STT
  synthesize(text: string): Promise<AudioOutput>;        // TTS
  // Fase 2: startRealtimeSession(...) — sesión duplex, se agrega cuando exista
}
```

Fase 1 (push-to-talk) usa `transcribe`/`synthesize` como llamadas de request-response normales, reutilizando el `SendMessageUseCase` ya existente sin tocarlo — la voz es una entrada/salida alternativa al texto, no un pipeline paralelo. Fase 2 (duplex en tiempo real) añade un método de sesión aparte cuando llegue, sin invalidar Fase 1.

**Alternativas consideradas:**
- *Ir directo a una API realtime duplex (ej. modelo de sesión WebSocket con audio streaming bidireccional).* Descartada como punto de partida — no porque sea mala arquitectura a largo plazo (es el objetivo real), sino porque como primer incremento maximiza riesgo técnico sin necesidad (ver VISION_PRODUCT §8, R1).
- *Acoplarse directo a un proveedor concreto sin puerto.* Descartada — contradice el principio ya establecido en ADR-011 para texto; no hay razón para tratar voz distinto.

### ADR-015 (propuesto): Memoria de usuario estructurada antes que RAG

**Decisión propuesta:** `MemoryStorePort` con operaciones sobre hechos estructurados por usuario (`get(userId, key)`, `set(userId, key, value)`, `list(userId, category)`), no un motor de búsqueda semántica. Categorías iniciales: dispositivos, preferencias, proyectos, horarios recurrentes. Persistido en Supabase (cuando ADR-007 se active) o, mientras tanto, en el mismo tipo de store JSON local ya usado por `SafetyPolicyStore`/`PluginManager` para no bloquear el incremento en la migración de persistencia.

**Alternativas consideradas:**
- *RAG completo con embeddings desde el inicio.* Descartada por ahora — sobre-ingeniería frente al caso de uso real descrito (datos estructurados, no recuperación semántica sobre texto libre). Se revisita si aparece un caso de uso que genuinamente lo necesite.

### ADR-016 (propuesto): Identidad mínima de usuario como prerequisito de Memoria, separada de Auth completo

**Decisión propuesta:** introducir un `userId` estable (aunque sea de un único usuario local, sin login todavía) antes de construir Memoria sobre él, en vez de esperar a que el sistema de autenticación completo del roadmap original esté terminado. Auth completo (Supabase Auth, sesiones, multi-usuario real) sigue siendo necesario para cualquier uso más allá de un desarrollador en su máquina, pero no debe bloquear que Memoria empiece.

**Alternativas consideradas:**
- *Esperar a Auth completo antes de tocar Memoria.* Descartada — encadena un ítem de experiencia visible (Memoria) a un ítem de infraestructura más grande y con más incertidumbre de alcance, sin necesidad real.

---

## 3. Mapeo detallado por funcionalidad

### 3.1 Rediseño de interfaz + Dashboard

- `apps/web`: nueva estructura de rutas (hoy es una sola página de chat demo). Un layout con navegación entre Chat, Dashboard y (más adelante) Automatizaciones.
- Endpoints del Gateway que faltan para alimentar el dashboard sin exponer detalle técnico: un endpoint agregado tipo `GET /v1/status` que devuelva un resumen ya traducido (ej. `{ healthy: boolean, devices: [...], activePlugins: [...] }`) en vez de que el frontend tenga que combinar `/v1/agents` + `/v1/audit` y decidir cómo traducirlo — esa traducción es lógica de producto y debe vivir en el Gateway o en una capa de BFF en `apps/web`, nunca duplicada en cada cliente (web, futuro móvil).
- Ningún cambio a `gateway-core`'s módulos existentes — es un endpoint HTTP nuevo sobre lo que `AgentRegistry`/`GlobalCapabilityRegistry`/`AuditService` ya exponen.

### 3.2 Personalidad

- Config de persona (tono, estilo, límites) como parte del `systemPrompt` que ya arma `SendMessageUseCase` — no requiere infraestructura nueva, es contenido, versionable como cualquier otro archivo de configuración del repo.
- Riesgo bajo, impacto visible alto — candidato a primer incremento real de Línea B junto con el rediseño base.

### 3.3 Visión por computadora

- `packages/core`: `Message` gana un campo opcional de contenido multimodal (imagen), sin romper el uso actual de solo-texto.
- `packages/ai-abstraction`: `GeminiProvider` ya puede mandar partes de imagen a `generateContent` — es una extensión de `toGeminiContent()`, no una funcionalidad nueva del proveedor.
- `apps/web`: UI de carga de imagen en el chat.

### 3.4 Voz — Fase 1

- `@kan/voice-abstraction` (nuevo paquete) con `VoiceProviderPort` (ADR-014) y una primera implementación real (proveedor a elegir en el momento de implementar — se evalúa entonces, no se fija aquí, siguiendo el mismo principio de no acoplarse prematuramente).
- `apps/web`: botón de conversación, captura de audio, llamada a `transcribe()` → texto entra al `SendMessageUseCase` existente sin cambios → respuesta de texto sale por `synthesize()`.
- Cero cambios al Gateway, Edge Agent o Function Calling — la voz es una fachada de entrada/salida sobre el chat que ya funciona.

### 3.5 Notificaciones proactivas

- `gateway-core`: reemplazar `ConsoleNotificationService` (stub actual) por una implementación real. Primer canal: eventos empujados a `apps/web` (ej. vía Server-Sent Events o polling corto — decisión de implementación a tomar en el incremento correspondiente, no aquí).
- Fuente de las notificaciones: eventos que ya existen en el bus (`capability.completed`, `capability.failed`, `device.disconnected`, `safety_policy.changed`) traducidos a lenguaje natural — otra vez, sin infraestructura nueva de fondo, es activar un seam ya documentado (docs/12 §9) y conectarlo a un canal real.

### 3.6 Memoria estructurada

- `packages/core` o paquete nuevo `@kan/memory`: `MemoryStorePort` (ADR-015) + inyección de hechos relevantes en el `systemPrompt` de `SendMessageUseCase` (mismo mecanismo que ya usa `tools`, como contexto adicional opcional).
- Depende de ADR-016 (identidad mínima de usuario).

### 3.7 Automatización programada (Scheduler real)

- `gateway-core`: reemplazar `NoopScheduler` por una implementación real (ej. sobre `node-cron` o un timer simple persistido). Dispara `TaskOrchestrator.submit()` en el horario programado — reutiliza el orquestador existente, no uno nuevo.

### 3.8 Voz — Fase 2 (duplex en tiempo real)

- Extiende `VoiceProviderPort` con un método de sesión (`startRealtimeSession`), evaluado una vez que Fase 1 esté en producción y se conozca el comportamiento real del proveedor elegido en Fase 1 (o uno distinto, si el caso de uso duplex lo justifica).

### 3.9 Planificación multi-paso

- `gateway-core`: extensión del `TaskOrchestrator` hacia planes de múltiples pasos — exactamente la propuesta P5 ya documentada en `docs/16-arquitectura-propuestas-v0.1.md`, ahora con motivación de producto concreta en vez de abstracta.
- Depende de 3.1 (dashboard, para mostrar el plan), 3.6 (memoria, para preferencias) y 3.7 (scheduler, para programar el resultado del plan).

---

## 4. Orden de incrementos propuesto (histórico — superseded por §0)

Alternando Línea A / Línea B por incremento (ver VISION_PRODUCT §8, R2 — paralelismo de roadmap, no de ejecución simultánea):

| # | Incremento | Línea |
|---|---|---|
| 1 | Rediseño de interfaz base + Dashboard mínimo (consumiendo endpoints ya existentes) | B |
| 2 | Validación real de `inputSchema` (JSON Schema) — docs/16 P1, pendiente desde antes de este pivote | A |
| 3 | Personalidad (persona config en el prompt) | B |
| 4 | Identidad mínima de usuario (ADR-016) | A |
| 5 | Visión por computadora (imágenes en el chat) | B |
| 6 | `@kan/voice-abstraction` + Voz Fase 1 (ADR-014) | B |
| 7 | Notificaciones proactivas reales (activa `NotificationServicePort`) | A/B (infraestructura + UX inseparables aquí) |
| 8 | Memoria estructurada (ADR-015, sobre identidad de #4) | B |
| 9 | Scheduler real (activa `SchedulerPort`) | A |
| 10 | Automatización multi-paso (docs/16 P5) | B |
| — | Auth completo (Supabase), CNC/láser/impresión 3D, resto del roadmap técnico original | A, continúa en paralelo de fondo sin bloquear lo anterior |

Este orden es una propuesta, no un compromiso rígido — cada incremento se confirma antes de empezarlo, siguiendo el mismo proceso de siempre (análisis → alternativas → recomendación → aprobación → implementación).

---

## 5. Qué NO cambia

- El Device Simulator, `plugin-esp32-arduino`, el Safety Policy engine, el Gateway y el Edge Agent siguen exactamente como están. Ningún incremento de este plan los toca salvo donde se indica explícitamente (Scheduler, NotificationService).
- El proceso de trabajo sigue siendo el mismo: análisis, alternativas con pros/contras, recomendación, esperar aprobación, recién ahí implementar. Este documento es esa primera fase para el pivote completo — cada incremento individual de la tabla del §4 pasa por el mismo proceso otra vez, en su momento, con más detalle del que tiene sentido fijar hoy.
