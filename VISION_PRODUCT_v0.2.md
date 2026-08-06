# VISION_PRODUCT_v0.2.md — KAN como asistente inteligente

> Este documento formaliza un cambio de estrategia de producto decidido el 2026-08-06. No reemplaza `README.md` (el mandato original sigue vigente) ni `docs/09-roadmap.md` (el roadmap técnico se ajusta, no se descarta) — los complementa con la capa que faltaba: **qué debe sentir el usuario**, no solo qué debe poder hacer el sistema.

---

## 1. Por qué este documento existe

Hasta el Milestone v0.1 + `plugin-esp32-arduino`, KAN construyó correctamente una **plataforma técnica**: Core, Gateway, Edge Agent, Plugin SDK, Function Calling, Safety Policy, auditoría, testing. Todo esto es necesario pero no es el producto — es la cimentación.

El objetivo original, escrito en el README desde el primer día, siempre fue distinto: **un sistema tipo Jarvis**. Un asistente que se sienta presente, que entienda contexto, que actúe sobre el mundo físico y digital, que hable, que recuerde, que sea proactivo. Nada de eso es un requisito técnico — es una experiencia. Y una experiencia no emerge sola de tener una arquitectura limpia; hay que diseñarla y construirla con la misma disciplina.

Este documento es la especificación de esa mitad que faltaba.

---

## 2. Visión del producto

**KAN es un compañero inteligente para el mundo digital y físico del usuario — no una interfaz de programación, no un panel técnico, no un chatbot con herramientas.**

El usuario nunca debe percibir que existe un Gateway, un Edge Agent, un plugin, un proveedor de IA o una base de datos. Para el usuario existe una sola entidad: **KAN**, que resulta que sabe leer un sensor, mover un eje, imprimir una pieza, analizar una foto o simplemente charlar — sin que el usuario tenga que saber cómo.

Esto no es una promesa de marketing sobre una arquitectura ya construida. Es un principio de diseño que ya estaba parcialmente servido por decisiones tomadas desde el ADR-001 (arquitectura hexagonal, puertos y adaptadores) — el trabajo pendiente es sobre todo de **superficie**: qué ve, oye y siente el usuario, y disciplina para que ningún nombre interno (Gemini, Gateway, Supabase, Edge Agent) se filtre jamás a una respuesta o a la interfaz.

---

## 3. Principios de diseño

1. **Todo detalle técnico es invisible por defecto.** Si una respuesta de KAN menciona "el Gateway" o "tu proveedor de IA", es un bug de producto, no un detalle de implementación aceptable.
2. **Cada incremento debe ser sentido, no solo medido.** Un incremento que solo mejora latencia interna sin que el usuario note nada no cuenta como progreso de la Línea B, aunque sea trabajo legítimo de la Línea A.
3. **Proactivo, no solo reactivo.** KAN no espera siempre una orden — informa, sugiere, avisa. Pero proactivo no es invasivo: la frecuencia y el tono de las notificaciones son parte del diseño, no un efecto secundario.
4. **Preguntar antes que asumir.** Cuando falta información para actuar con confianza (sobre todo en acciones físicas), KAN pregunta — igual que ya lo hace el Permission Manager a nivel de infraestructura (ADR-004), la personalidad de KAN debe reflejar esa misma cautela a nivel conversacional.
5. **Multi-proveedor por diseño, en todo, no solo en texto.** El principio que ya rige `AIProviderPort` (ADR-011: nunca acoplarse a un proveedor concreto) se extiende ahora a voz (`VoiceProviderPort`) y, cuando llegue, a memoria/embeddings. Cambiar de proveedor debe ser siempre un adaptador nuevo, nunca una reescritura.
6. **La calidad de la Línea A es un prerequisito de la Línea B, no una alternativa a ella.** Una función de voz o un dashboard que se cae porque el Gateway no es confiable no es una mejora de experiencia — es una experiencia peor que no tenerlo. Las dos líneas avanzan juntas porque se necesitan mutuamente, no porque compitan por prioridad.

---

## 4. Experiencia de usuario objetivo

### 4.1 Lo que el usuario ve al abrir KAN — Dashboard

Un estado general del sistema traducido a lenguaje humano, no a métricas técnicas:

- Estado de KAN (todo bien / atención requerida — nunca "Core: ✅ Gateway: ✅ Edge Agent: ✅" expuesto tal cual, eso es una vista de depuración, no de producto).
- Dispositivos conectados (robots, impresoras, CNC, ESP32, automatización del hogar) con su estado en lenguaje natural.
- Plugins/capacidades activas, presentadas como "lo que KAN puede hacer ahora", no como una lista de paquetes npm.
- Conversaciones recientes.
- Automatizaciones programadas.
- Notificaciones — lo que pasó mientras el usuario no estaba mirando.

### 4.2 Conversación

Un botón de conversación grande, con activación por palabra clave ("KAN"), pensado para diálogo natural, no para comandos rígidos tipo CLI. Ejemplos objetivo (ya declarados por el usuario, se preservan tal cual como criterio de aceptación):

> "KAN, crea este modelo en 3D." · "KAN, analiza esta fotografía." · "KAN, conecta el robot." · "KAN, imprime esta pieza." · "KAN, programa el corte para las diez de la noche." · "KAN, investiga este tema." · "KAN, explícame este circuito." · "KAN, ¿qué dispositivos tengo conectados?" · "KAN, ¿qué ocurrió mientras estaba fuera?"

### 4.3 Estado permanente y proactividad

KAN informa sin que se le pregunte: "La impresora terminó hace diez minutos.", "El ESP32 perdió conexión.", "El robot terminó su tarea.", "No encontré ningún problema durante tu ausencia." — esto requiere que KAN tenga *algo* que decir incluso cuando no pasó nada malo (el último ejemplo es tan importante como los demás: la ausencia de alertas también es información).

### 4.4 Personalidad

Tono profesional, natural, capaz de resumir, explicar y — cuando falta información — preguntar en vez de asumir. Consistente entre sesiones (esto depende de que exista memoria — ver §4.6).

### 4.5 Visión por computadora

Recibir imágenes, fotografías, planos, modelos y documentos, y actuar sobre ellos: analizar un STL, explicar un circuito, detectar errores, generar un modelo.

### 4.6 Memoria

Más allá del historial de una conversación: dispositivos del usuario, proyectos, preferencias, horarios, automatizaciones, flujos de trabajo recurrentes.

### 4.7 Automatización y planificación

KAN no solo ejecuta órdenes — planifica. El ejemplo de referencia ("quiero fabricar esta pieza" → analizar modelo, calcular tiempo, recomendar material, estimar costo, verificar disponibilidad, proponer horario, programar la tarea, notificar al terminar) es el criterio de qué significa "asistente" en vez de "control remoto por voz".

---

## 5. Arquitectura de UX (cómo se traduce esto a la plataforma existente)

Esta sección conecta la visión con la arquitectura real, no la reemplaza. El detalle técnico completo vive en `docs/17-plan-implementacion-v0.2.md`; aquí solo el mapeo de responsabilidad.

| Necesidad de producto | Dónde vive hoy / dónde debe vivir |
|---|---|
| Dashboard de estado | `apps/web`, nuevas rutas, consumiendo endpoints ya existentes del Gateway (`GET /v1/agents`, `GET /v1/audit`) + nuevos que faltan (estado agregado, notificaciones) |
| Conversación por voz | Nuevo `VoiceProviderPort` (mismo patrón que `AIProviderPort`, ADR-011) — ver ADR-014 |
| Estado permanente / proactividad | `NotificationServicePort` y `SchedulerPort` del Gateway — **ya existen como seams documentados** (docs/12 §8-9), hoy son stubs (`ConsoleNotificationService`, `NoopScheduler`). Este es el momento de implementarlos de verdad. |
| Personalidad | Capa de prompt/configuración en `@kan/core` o `@kan/ai-abstraction` — no requiere nueva infraestructura, es diseño de producto sobre lo que ya existe |
| Memoria | Nuevo `MemoryStorePort` — ver ADR-015. Depende de persistencia real (Supabase, ADR-007, todavía pendiente) |
| Visión por computadora | Extensión de `Message`/`ChatRequest` para contenido multimodal — Gemini ya soporta imágenes vía `generateContent`, es una extensión del proveedor existente, no una capacidad nueva que construir desde cero |
| Automatización/planificación | Extensión del Task Orchestrator del Gateway hacia planes multi-paso — **ya anticipado** como seam en docs/12 y como propuesta P5 en `docs/16-arquitectura-propuestas-v0.1.md` |

La conclusión operativa de esta tabla: **la mayoría de la Línea B no requiere inventar arquitectura nueva — requiere activar seams que la Línea A ya dejó preparados a propósito.** Eso reduce el riesgo real de este pivote de forma significativa frente a "estamos construyendo un producto nuevo desde cero".

---

## 6. Roadmap de experiencia (Línea B)

Ordenado por relación esfuerzo/impacto visible, no por orden de aparición en el pedido original:

1. **Rediseño de la interfaz base + Dashboard mínimo.** Sin esto, ninguna otra mejora se "siente" — es el contenedor de todo lo demás.
2. **Personalidad y respuestas naturales.** Es prompt/config, no infraestructura nueva — el incremento con mejor relación esfuerzo/impacto disponible.
3. **Visión por computadora (subir una imagen y que KAN la entienda).** El proveedor ya lo soporta; el trabajo es de protocolo (`Message` multimodal) y UI.
4. **Voz — Fase 1 (push-to-talk).** Hablar, transcribir, reusar el pipeline de chat/function-calling ya construido, responder con voz sintetizada. Deliberadamente NO full-duplex todavía — ver §8, riesgo R1.
5. **Notificaciones proactivas reales.** Activar `NotificationServicePort` con un canal real (empezar simple: push/toast en la propia app; no hace falta email/SMS día uno).
6. **Memoria estructurada (hechos, no RAG todavía).** "Mis dispositivos", "mis preferencias" como datos estructurados por usuario — ver ADR-015, deliberadamente antes de invertir en embeddings/búsqueda semántica.
7. **Automatización programada (Scheduler real).** "Programa el corte para las diez de la noche" — activa `SchedulerPort`.
8. **Voz — Fase 2 (conversación en tiempo real, duplex).** Una vez que Fase 1 probó la abstracción `VoiceProviderPort` en producción.
9. **Planificación multi-paso (el ejemplo de "fabricar esta pieza").** El incremento de mayor ambición — depende de que 3, 6 y 7 ya existan.

## 7. Roadmap técnico (Línea A — continúa sin cambios de fondo)

Sin cambios respecto a lo ya documentado en `docs/09-roadmap.md` y `RELEASE_NOTES_v0.1.md`, con dos ajustes de secuencia motivados directamente por la Línea B:

- **Autenticación de usuario (Supabase Auth) sube de prioridad.** Antes era "condición para uso más allá de un desarrollador"; ahora también es **prerequisito directo de Memoria** (§6.6) — no se puede tener "mis dispositivos" sin una identidad de usuario mínima. No hace falta el sistema de auth completo del roadmap original todavía, pero sí una identidad estable por usuario antes de construir memoria sobre ella.
- **Validación real de `inputSchema` (JSON Schema)** sigue pendiente (docs/16, P1) y se mantiene como prioridad de endurecimiento, sin relación directa con la Línea B pero sin motivo para posponerla más.

El resto (CNC, láser, impresión 3D, robots, home automation, CI/CD) continúa exactamente como está documentado.

---

## 8. Riesgos y recomendaciones

Esta sección existe porque el mandato del proyecto (README, "MI FORMA DE TRABAJAR") pide explícitamente cuestionar decisiones cuando hay una alternativa mejor — no solo ejecutar el pedido tal cual llegó.

**R1 — Voz full-duplex en tiempo real desde el primer incremento es el ítem de mayor riesgo técnico de todo este documento.** Una sesión de voz realmente conversacional (interrupciones, latencia baja, turnos naturales) es un problema de ingeniería sustancialmente distinto a "grabar audio → transcribir → responder → sintetizar". Construirlo primero significa que el primer resultado visible de la Línea B tarda más y es el más frágil.
**Recomendación:** dividir en dos fases como en §6 (push-to-talk primero, duplex después). Esto no traiciona "quiero empezar ya con voz" — empieza inmediatamente, solo que con la versión que se puede entregar bien en un incremento corto, y que ya obliga a construir la abstracción `VoiceProviderPort` correctamente (que es el activo reutilizable real, no la sesión duplex en sí).

**R2 — "Dos líneas en paralelo" con un único desarrollador (o un equipo pequeño) no es paralelismo real, es alternancia.** Si se interpreta literalmente como "avanzan simultáneamente todo el tiempo", el resultado real es contexto fragmentado y ambas líneas más lentas.
**Recomendación:** planificar en incrementos que alternan explícitamente de línea (ej. un incremento de Línea A seguido de uno de Línea B), no como dos streams simultáneos. El *roadmap* es paralelo (ninguna línea espera meses a la otra); la *ejecución* es secuencial por incremento. Si en el futuro hay más de una persona/agente trabajando, ahí sí cabe paralelismo real.

**R3 — Memoria con RAG/embeddings desde el día uno es sobre-ingeniería prematura.** El caso de uso descrito ("mis dispositivos", "mis preferencias", "mis horarios") es datos estructurados, no búsqueda semántica sobre texto libre.
**Recomendación:** empezar con un `MemoryStorePort` de hechos estructurados (mismo patrón que `ConfigStorePort` ya usa `PluginManager`/`SafetyPolicyStore`), y solo evaluar RAG/embeddings cuando aparezca un caso real que lo necesite (ej. "qué me dijiste el mes pasado sobre X" sobre texto libre, no sobre datos estructurados).

**R4 — El dashboard puede degenerar en un panel técnico disfrazado si no se diseña con disciplina de producto.** Es fácil que "estado del Core, estado del Gateway, estado del Edge Agent" termine mostrado literalmente porque son los datos que ya existen — violando el principio 1 de este documento.
**Recomendación:** cada pantalla nueva pasa por la pregunta del §9 antes de aceptarse: "¿esto hace que KAN se sienta más como un asistente, o más como un panel de administración?".

**R5 — Automatización/planificación multi-paso es la funcionalidad más ambiciosa del roadmap y la que más depende de que todo lo demás ya exista** (memoria para saber preferencias de material/horario, Scheduler real, Task Orchestrator extendido, Safety Policy aplicada a un plan completo y no solo a un paso). Intentarla temprano arriesga construir sobre cimientos que todavía no están.
**Recomendación:** mantenerla como el último ítem del roadmap de experiencia (§6.9), no reordenar por presión de "es lo más impresionante".

---

## 9. Filosofía — criterio de aceptación para toda decisión futura

Antes de aceptar cualquier funcionalidad nueva, en cualquiera de las dos líneas:

> **¿Hace que KAN se sienta más como un verdadero asistente inteligente?**

Si la respuesta es no, no es necesariamente una mala idea — pero probablemente no es la siguiente prioridad. Este criterio aplica tanto a Línea A como a Línea B: un endurecimiento de seguridad que nadie nota también puede pasar la prueba, indirectamente, si es lo que le permite a KAN actuar con confianza sobre algo físico sin que el usuario tenga que supervisarlo de cerca — que es, en sí mismo, parte de sentirse como un asistente y no como una herramienta que hay que vigilar.

---

## 10. Qué sigue

El plan de implementación detallado (paquetes concretos a crear/modificar, ADRs nuevos, orden de incrementos, sin escribir código todavía) vive en [`docs/17-plan-implementacion-v0.2.md`](docs/17-plan-implementacion-v0.2.md).
