# KAN — Análisis del CTO y Decisiones Arquitectónicas (ADRs)

> Este documento es el punto de entrada al pensamiento arquitectónico del proyecto. No contiene código. Contiene decisiones, y las razones detrás de cada una, incluyendo dónde me aparto de lo planteado en el README original.

## 1. Resumen de la visión

KAN se plantea como un **sistema operativo modular de IA**: un núcleo (Core) que entiende lenguaje natural, orquesta agentes y modelos de IA, y delega toda funcionalidad concreta (impresión 3D, CNC, robótica, domótica, visión artificial...) a plugins instalables bajo demanda. Filosofía plugin-first, multi-proveedor de IA, multiplataforma, clean architecture.

Es una visión ambiciosa y coherente. El mayor riesgo no es la falta de claridad — el README es inusualmente claro — sino la tentación de construir demasiado, demasiado pronto. Mi trabajo como arquitecto es proteger el MVP de esa ambición sin traicionarla.

## 2. Fortalezas de la visión (no las voy a repetir en cada doc, pero son la base de todo)

- **Separación Core/Plugin desde el día uno** es la decisión correcta. Evita que KAN se convierta en un monolito de integraciones.
- **Abstracción de proveedor de IA desde el día uno** (no depender solo de Gemini) es correcta y barata de implementar bien ahora, cara de arreglar después.
- **"Offline first cuando sea posible"** es una restricción sana para un sistema que controla hardware: la red no debería ser un punto único de fallo para, por ejemplo, un botón de emergencia.

## 3. Dónde cuestiono el planteamiento original

Como pediste explícitamente que cuestione decisiones cuando exista una alternativa mejor, aquí está lo que cambiaría, documentado como ADRs (Architecture Decision Records) para que quede trazable.

---

### ADR-001: Introducir un "Edge Agent" local — Next.js/Vercel no puede ser el único backend

**Contexto.** El README propone Next.js API + Vercel como backend. Pero KAN debe controlar hardware físico (impresoras 3D, CNC, ESP32, robots, cámaras) que vive en la red local del usuario. Vercel ejecuta funciones serverless sin estado, con timeouts cortos, sin acceso a puertos USB/serial del usuario, y sin capacidad de mantener conexiones persistentes (MQTT, WebSocket a un ESP32 en la LAN, sockets serie a una impresora).

**Alternativas consideradas:**
1. Mantener solo Vercel y exponer los dispositivos vía servicios cloud de terceros (ej. impresoras con API cloud propia). Descartado: no todos los dispositivos objetivo (Arduino, PLC, brazos robóticos genéricos) tienen esa opción, y ataría a KAN a integraciones de terceros en vez de control directo.
2. Pedir al usuario que abra puertos/exponga su red (port forwarding). Descartado: inseguro, mala UX, inviable para usuarios no técnicos.
3. **Un "Edge Agent"**: un proceso ligero que el usuario instala en una máquina de su red local (puede ser la misma app de escritorio de KAN). Mantiene conexión saliente persistente y autenticada hacia el Core (cloud), y habla los protocolos nativos del hardware local (Serial/USB, MQTT, Bluetooth, red local). El Core nunca necesita conexión entrante a la red del usuario.

**Decisión.** Opción 3. El Edge Agent es un componente de primera clase del Core lógico (comparte el mismo dominio y los mismos contratos de plugin), no un plugin más.

**Consecuencias.**
- El Core se divide en **Core Cloud** (orquestación, IA, memoria, usuarios, permisos, marketplace) y **Core Edge** (Edge Agent: registro de dispositivos locales, ejecución de plugins de hardware, cola de comandos offline).
- La app de escritorio (Windows/Linux/macOS) puede *ser* el Edge Agent con UI, resolviendo dos requisitos del README a la vez.
- Introduce un nuevo requisito de seguridad: canal Core↔Edge Agent autenticado y cifrado (ver docs/06 comunicación).
- Habilita el requisito "Offline First": el Edge Agent puede ejecutar comandos ya planificados sin conexión a internet.

---

### ADR-002: Monorepo (Turborepo) para compartir el Core entre todas las plataformas

**Contexto.** El README exige que Web, Android, iOS, Windows, Linux y macOS "compartan el mismo Core".

**Decisión.** Monorepo con Turborepo (o Nx) conteniendo paquetes TypeScript compartidos (`@kan/core`, `@kan/plugin-sdk`, `@kan/ai-abstraction`, `@kan/device-protocol`) consumidos por: la app Next.js (web), la app de escritorio (Electron, que también aloja el Edge Agent) y la app móvil.

**Alternativas descartadas:** polyrepo (múltiples repos) — genera drift entre plataformas y duplica lógica de negocio, exactamente lo que el README quiere evitar.

**Consecuencia directa:** condiciona la elección de framework móvil — ver ADR-005.

---

### ADR-003: Plugins de hardware/IA pesada corren fuera de proceso (sidecars), no in-process

**Contexto.** El README pide plugins para visión artificial, CAD, robótica, procesamiento con Python. TypeScript/Node no es el mejor entorno para OpenCV, generación de mallas 3D o librerías de robótica; el ecosistema Python domina ahí.

**Decisión.** Dos clases de plugin:
- **Plugins ligeros (in-process, TS):** lógica de orquestación, integraciones de API (Telegram, GitHub, Home Assistant). Corren dentro del proceso del Core/Edge Agent, sandboxeados con permisos declarados.
- **Plugins pesados (out-of-process, sidecar):** visión artificial, CAD, robótica, PLC. Corren como proceso o contenedor separado (Python), comunicándose con el Core/Edge Agent vía gRPC o WebSocket con un contrato de mensajes versionado. Esto también es la barrera de seguridad principal: un plugin de terceros con bug o malicioso no puede tirar el proceso del Core ni acceder a memoria de otros plugins.

**Consecuencia:** el "Plugin SDK" no es una sola librería, son dos: `@kan/plugin-sdk-ts` y `kan-plugin-sdk-py`, con el mismo contrato de manifest.

---

### ADR-004: Capa de confirmación y simulación obligatoria para acciones físicas irreversibles

**Contexto — esto no estaba en el README y lo considero una omisión crítica de seguridad, no una preferencia de estilo.** KAN puede ejecutar comandos que cortan material con láser, mueven un brazo robótico o imprimen. Estas acciones pueden causar daño material, incendios o lesiones si un LLM malinterpreta una instrucción ambigua ("corta esto" sobre el archivo equivocado, coordenadas erróneas en un CNC).

**Decisión.** Toda acción de un plugin se clasifica por severidad (`read-only`, `reversible`, `irreversible-material`, `safety-critical`). Las dos últimas categorías **requieren**:
1. Un paso de simulación/preview cuando el dispositivo lo soporte (dry-run, previsualización del G-code, etc.).
2. Confirmación explícita del usuario antes de ejecutar (no basta con que el LLM "decida" ejecutar).
3. Un mecanismo de parada de emergencia accesible fuera del flujo conversacional.

**Consecuencia:** esto se convierte en un requisito del Core (Permission Manager + Task Coordinator), no algo que cada plugin implemente por su cuenta — de lo contrario será inconsistente y alguien lo olvidará.

---

### ADR-005: Mobile — React Native sobre Flutter

**Contexto.** El README pide evaluar y justificar. Con el monorepo TS decidido en ADR-002, el criterio decisivo es compartir lógica de negocio, no solo estética de UI.

**Comparación:**

| Criterio | React Native | Flutter |
|---|---|---|
| Comparte lenguaje/lógica con Core (TS) | Sí, directo | No (Dart) — requiere reimplementar o exponer vía API |
| Madurez librerías BLE/USB para IoT | Buena | Buena |
| Rendimiento UI compleja (viewers 3D, CAD) | Bueno con librerías nativas | Muy bueno, motor propio |
| Curva de equipo (ya usan TS/Next.js/React) | Baja | Alta (Dart nuevo) |

**Decisión.** React Native (con Expo para acelerar el MVP). Se reevalúa Flutter si en Fase 2 la app necesita renderizado 3D/CAD muy intensivo donde el motor gráfico propio de Flutter dé ventaja real.

---

### ADR-006: Desktop — Electron para el MVP, evaluar Tauri en Fase 2

**Contexto.** La app de escritorio también aloja el Edge Agent (ADR-001), que necesita acceso robusto a Serial/USB/Bluetooth.

**Decisión.** Electron para el MVP: ecosistema Node maduro para hardware (`serialport`, `node-usb`, `noble` BLE) reduce riesgo en el mes 1. Tauri (Rust) se evalúa para Fase 2 por menor consumo de recursos, una vez que el contrato del Edge Agent esté estable y el riesgo de reescritura sea menor.

---

### ADR-007: Supabase Free y Gemini Free son adecuados para el MVP, con salida planificada

**Decisión.** Se mantienen tal como propone el README, pero documentados como decisión temporal, no definitiva:
- Supabase Free: límites de proyecto pausado por inactividad y 500MB de DB son aceptables para MVP/demo, no para usuarios reales concurrentes. Migración a plan Pro es un simple cambio de configuración si el esquema respeta Postgres estándar (evitar features exclusivas de un tier).
- Gemini Free: rate limits bajos. La abstracción de proveedor (ya exigida por el README) es lo que hace esto seguro: si Gemini limita, se enruta a otro proveedor sin tocar el Core.

---

### ADR-008: Marketplace de plugins de terceros — firma de código y modelo de permisos por capacidades desde el diseño inicial

**Contexto.** El objetivo final incluye una tienda de plugins de terceros. Un plugin de terceros con acceso a control de hardware físico es, en esencia, código no confiable con capacidad de causar daño real. No es un problema para "después"; el modelo de permisos tiene que existir en el Core desde la Fase 1, aunque el marketplace público no se abra hasta más adelante.

**Decisión.** Manifest de plugin declara permisos explícitos (qué dispositivos, qué severidad de acciones, qué datos). El Core deniega por defecto (deny-by-default) y el usuario aprueba explícitamente cada permiso al instalar, igual que permisos de un sistema operativo móvil. Firma de paquetes desde el primer plugin publicado, no se retrofitea.

---

### ADR-009: Core Gateway — servicio Node separado para el WebSocket del Core, no una API route de Next.js

**Contexto.** El Edge Agent (`packages/edge-agent-core`) ya implementa el lado cliente del protocolo Core↔Edge Agent (`CoreWebSocketClient`, ver docs/07): conecta saliente, heartbeat, reconexión con backoff. Falta el lado servidor. Por ADR-001, ese servidor **no puede vivir en las API routes de `apps/web` sobre Vercel**: son funciones serverless sin estado ni conexiones persistentes, exactamente el problema que motivó la existencia del Edge Agent.

**Decisión.** El servidor WebSocket del Core (el "Core Gateway") es un **servicio Node independiente**, deployado aparte de `apps/web` (no en Vercel — en cualquier entorno con proceso persistente: un contenedor, una VM pequeña, Fly.io/Render, etc.). Expone:
- Un endpoint WebSocket (`/edge`) donde los Edge Agents se conectan, hablando el protocolo de `packages/plugin-contract/src/protocol.ts`.
- Una API interna (HTTP simple) que `apps/web` sí puede llamar de forma normal (una función serverless haciendo un `fetch` saliente no tiene ningún problema — lo que no puede hacer es *ser* el servidor persistente) para despachar `AgentTaskDispatchMessage` y consultar qué Edge Agents/capabilities están conectados ahora mismo.

**Alternativas descartadas:**
- Forzar `apps/web` a un servidor Node custom (Next.js permite esto) desplegado fuera de Vercel: viable pero acopla el ciclo de release del Core Gateway al de la app web sin necesidad; son responsabilidades distintas (una es BFF/UI, la otra es infraestructura de tiempo real).
- Usar Supabase Realtime como transporte en vez de WebSocket propio: se reevalúa en el futuro si simplifica operaciones, pero el protocolo ya definido (heartbeat, hello con sync de capabilities, dispatch/telemetría) es más específico de lo que Realtime ofrece out-of-the-box.

**Consecuencia.** ~~Este incremento (Edge Agent + Simulador) se valida standalone, sin este servidor.~~ **Actualización (Milestone v0.1):** implementado y probado — `apps/gateway` + `packages/gateway-core` (`docs/12-arquitectura-gateway.md`). El endpoint HTTP interno terminó siendo una API versionada completa (`/v1/tools`, `/v1/tools/:name/execute`, `/v1/agents`, `/v1/audit`), no solo "dispatch + consulta" como se anticipaba aquí.

### ADR-010: La confirmación de acciones peligrosas permanece local al Edge Agent — nunca se delega al chat remoto

**Contexto.** Con el Gateway real y el `TaskOrchestrator` despachando tareas, surgió la pregunta obvia: cuando una capability `irreversible-material`/`safety-critical` queda `pending_confirmation`, ¿por qué no dejar que el usuario la confirme escribiendo "sí" en el chat, ya que de ahí vino la orden?

**Decisión.** No. `TaskOrchestrator.submit()` resuelve de inmediato con `status: "pending_confirmation"` en cuanto el Edge Agent lo reporta — no espera a que nadie la confirme por ningún canal remoto. La confirmación real solo puede darse en la UI del propio Edge Agent, en la máquina físicamente conectada al dispositivo.

**Alternativas descartadas:** exponer un endpoint en el Gateway (`POST /v1/confirmations/:id`) para que `apps/web` confirme en nombre del usuario vía chat. Técnicamente trivial de construir — se descartó por seguridad, no por costo de implementación.

**Por qué.** Un chat puede ser accedido remotamente (otro dispositivo, otra red, alguien que consiguió el link). Exigir que la confirmación de "cortar con láser" o "mover el brazo robótico" ocurra físicamente en la máquina conectada al hardware es una propiedad de seguridad real: quien confirma está, por construcción, cerca de las consecuencias. Delegarlo al chat rompería esa garantía por conveniencia.

**Consecuencia.** El chat le informa al usuario que hay una confirmación pendiente y que debe resolverla en la app de escritorio — no puede resolverla por sí mismo. Documentado también en `docs/12` §4 y verificado con tests (`ToolExecutor.test.ts`).

### ADR-011: No adoptar el Vercel AI SDK como capa base de `@kan/ai-abstraction`

**Contexto.** `docs/05` (versión original) recomendaba apoyarse en el Vercel AI SDK para no reimplementar streaming/normalización de tool-calling entre proveedores.

**Decisión.** Al implementar `GeminiProvider` con function-calling real, la superficie necesaria (traducir `ToolDescriptor[]` a `functionDeclarations`, mapear mensajes con roles `tool`/`assistant-con-toolCall` a `Content[]` de Gemini, parsear `functionCalls()` de la respuesta) se escribió directo contra el SDK oficial `@google/generative-ai` en unas ~110 líneas bien testeadas (`GeminiProvider.test.ts`, 12 tests). El Vercel AI SDK habría añadido una dependencia y una capa de indirección adicional sin resolver un problema que no teníamos todavía (streaming real, múltiples proveedores simultáneos).

**Consecuencia.** Se reevalúa esta decisión el día que se agregue un segundo proveedor real (Claude/GPT) — si mapear cada proveedor a mano empieza a duplicar lógica de forma dolorosa, el Vercel AI SDK (u otra capa de normalización) vuelve a ser candidato. Documentado como decisión activa, no definitiva.

### ADR-012: Los límites de red se prueban con clientes reales, no con mocks

**Contexto.** Al escribir la Fase 4 de testing del Milestone v0.1, `WsConnectionManager` (el único módulo que toca WebSockets reales) podía haberse probado mockeando la librería `ws` — más rápido de escribir, pero no prueba nada sobre el protocolo HTTP de upgrade, el parseo de headers, ni el comportamiento real de cierre de sockets.

**Decisión.** `WsConnectionManager.test.ts` levanta un `http.Server` real en un puerto efímero y usa clientes `WebSocket` reales (de la misma librería `ws`) para probar: rechazo de token inválido, aceptación de hello válido, rechazo de versión de protocolo incompatible, rechazo de `hello` duplicado, reemplazo de conexión zombie por colisión de `edgeAgentId`, limpieza de estado al desconectar, y manejo de mensajes con forma inesperada. 9 tests, ~500ms.

**Consecuencia.** Esta es la prueba de mayor valor de todo el milestone: verifica exactamente los hardenings de seguridad de `docs/13`/`docs/15` contra el comportamiento real de la librería, no contra una simulación de cómo creemos que se comporta. Se adopta como criterio general: **cualquier módulo que sea "el único que toca X real" (transporte, filesystem, proceso hijo) se prueba contra X real cuando sea practico, no contra un doble.**

### ADR-013: Una sola configuración de ESLint compartida en la raíz, no `packages/config`

**Contexto.** `docs/02` (versión original) reservaba `packages/config` para eslint/tsconfig compartidos.

**Decisión.** Se implementó como un único `eslint.config.mjs` en la raíz del monorepo (ESLint 9, flat config, `typescript-eslint`), referenciado por cada paquete con `eslint . --config ../../eslint.config.mjs`, en vez de un paquete `@kan/config` publicable internamente. `apps/web` mantiene su propia config (`eslint-config-next`) por separado, ya que sus reglas son específicas de Next.js.

**Por qué.** Con 10 paquetes y una sola política de lint real (más `eslint-config-next` para web), un paquete npm interno completo era over-engineering — un archivo compartido con una ruta relativa cumple lo mismo con una fracción del código. `packages/config` queda como placeholder para el día que haga falta compartir algo más que una config de lint (ej. tokens de design system).

### ADR-017: Identidad y Auth vía puertos — Supabase como primer (y único) adaptador

**Contexto.** El pivote de producto (`VISION_PRODUCT_v0.2.md`) puso a la identidad de usuario (P0 del roadmap, `docs/17`) como la base sobre la que se construyen memoria, dispositivos, voz, automatizaciones y perfiles en incrementos futuros. El usuario pidió explícitamente que esto se diseñara sin tener que rehacer arquitectura después, y que Next.js (`apps/web`) actuara solo como BFF — nunca lógica de negocio directa contra el SDK de un proveedor.

**Decisión.** `AuthPort` y `UserProfilePort` viven en `@kan/core` (domain), igual que `AIProviderPort`/`ConversationRepositoryPort`/`ToolProviderPort`. El adaptador concreto vive en un paquete nuevo, `@kan/supabase-adapter` (mismo rol que `@kan/ai-abstraction` para el proveedor de IA): recibe un `SupabaseClient` ya construido por inyección, así el adaptador en sí no conoce Next.js ni maneja cookies — solo llama `.auth.*`/`.from(...)` del cliente que le pasan. Lo único atado a Next.js queda en `apps/web` (`lib/supabase/server.ts`, `middleware.ts`): construir el cliente por-request leyendo cookies (`@supabase/ssr`, patrón oficial para App Router) — es plomería de transporte, no lógica de negocio, igual que `WsConnectionManager` es infra y no aplicación en el Gateway (ADR-009). Sesión vía cookies (no localStorage/JWT manual) + RLS en la base de datos como línea de defensa real, no solo checks en la app. Se usa la `anon key` + sesión del usuario para todo — no se requiere `service_role key` en este incremento, ninguna operación necesita saltarse RLS todavía.

**Por qué.** Separar el puerto (domain, sin dependencias) del adaptador (paquete propio, con el SDK de Supabase) es lo que permite que un futuro cliente móvil (React Native, roadmap P7) reutilice `@kan/supabase-adapter` sin rediseño — solo cambia quién construye el `SupabaseClient` y quién le inyecta las cookies/tokens. Es el mismo patrón que ya demostró funcionar con `AIProviderPort`/`GeminiProvider`: cambiar de proveedor, o añadir un segundo consumidor del mismo puerto, nunca debería tocar el dominio.

**Consecuencia.** El esquema de base de datos (`supabase/migrations/`) se crea completo desde este incremento — `profiles`, `conversations`/`messages`, `user_preferences`, `memories`, `projects` — aunque varias tablas queden sin CRUD todavía (P0.2 y posteriores), para no tener que migrar esquema en cada incremento de identidad/memoria. Todas con RLS activado desde el día uno.

### ADR-014: `VoiceProviderPort` desacoplado — pero solo para STT, no para TTS

**Contexto.** `docs/17` había propuesto `VoiceProviderPort` con dos métodos simétricos, `transcribe()` y `synthesize()`, asumiendo que ambos serían llamadas a un proveedor de red. Al implementar Voz Fase 1 (push-to-talk) y buscar la opción "gratuita y muy efectiva" que pidió el usuario, resultó que STT y TTS no son simétricos en la práctica: Groq (Whisper) es un servicio de red real con un free tier generoso (2000 requests/día, sin tarjeta), pero la mejor opción de TTS gratuita sin límites de uso es la `SpeechSynthesis` **nativa del navegador** — que no es un servicio de red, es una Web API del lado del cliente.

**Decisión.** `VoiceProviderPort` (`@kan/core`) queda con un solo método por ahora: `transcribe(audio): Promise<string>`. Su adaptador, `GroqVoiceProvider` (paquete nuevo `@kan/voice-abstraction`, mismo rol que `@kan/ai-abstraction`), recibe la clave de Groq y llama `fetch` directo contra su API compatible con OpenAI — sin SDK, mismo criterio que ADR-011. La síntesis de voz de esta fase vive en `apps/web` como un hook de navegador (`lib/voice/useSpeechSynthesis.ts`) que llama `window.speechSynthesis` directo, fuera de la capa de puertos/adaptadores — no hay proveedor de red que envolver todavía.

**Por qué.** Forzar `synthesize()` en el puerto hoy habría significado una interfaz que ningún adaptador real implementa — peor que no tener el método. El puerto gana `synthesize()` el día que se sume un proveedor de TTS de red real (ElevenLabs, Google Cloud TTS), con el mismo patrón que ya funcionó para STT.

**Consecuencia.** La síntesis de voz depende del navegador del usuario (no todos soportan `SpeechSynthesis` igual, ej. Firefox Android) — se degrada en silencio si no está disponible, nunca rompe el chat. Es una limitación real y documentada, no oculta.

---

### ADR-018: Visión Fase 1 — imagen inline en `Message`, base64 en la fila (no Supabase Storage todavía)

**Contexto.** P3 (`docs/17` §3.3) pide imágenes en el chat: el usuario sube una foto (ej. de un dispositivo, un documento, una etiqueta) y el modelo la analiza. Hay dos formas razonables de llevar el bytes de la imagen desde el navegador hasta el proveedor de IA y, si hay sesión, hasta persistencia: (a) subirla a un bucket de Supabase Storage y pasar solo una URL/path por todo el sistema, o (b) viajar como base64 inline en el propio `Message`, igual que ya viaja `content`.

**Decisión.** (b) para esta fase: `Message` gana un campo opcional `image?: { data: string; mimeType: string }` (base64 sin prefijo `data:`), igual de simple que el resto del dominio (`content: string`). `SupabaseConversationRepository` lo persiste en dos columnas nuevas de `messages` (`image_data text`, `image_mime_type text`) vía la migración `0006_messages_image.sql`. `GeminiProvider` lo manda como `inlineData` en el mismo `Content` del mensaje. El límite de tamaño (4 MB) se aplica en el borde (`apps/web`, tanto en el input del navegador como en `/api/chat`), no en el dominio.

**Alternativas consideradas.**
- *Supabase Storage con URL firmada.* Es la opción correcta a mediano plazo (no infla la tabla `messages`, permite CDN, thumbnails, borrado independiente) pero añade un adaptador nuevo (`StoragePort`), un bucket con su propia política RLS, y lógica de subida/firma que ningún otro incremento de Fase 1 necesita todavía. Mismo criterio que ADR-015 con RAG: no sobre-construir antes de que el caso de uso real lo exija.
- *Base64 solo en memoria, sin persistir la imagen.* Descartada — rompe la promesa ya hecha en P0.2 de que una conversación persistida se puede releer completa; una respuesta del modelo que cita "la imagen que subiste" sin la imagen disponible al recargar es una regresión de UX.

**Consecuencia.** Un `messages.image_data` de varios MB en Postgres no escala indefinidamente — es una limitación conocida, no oculta. Si el uso real de Visión crece (muchas imágenes grandes, galería, recorte/preview), la migración a Supabase Storage es un cambio de adaptador (`SupabaseConversationRepository` implementa `ConversationRepositoryPort` igual, solo cambia qué guarda en `image_data`) — el dominio (`Message.image`) y el puerto no necesitan tocarse, así que no es una rearquitectura, es un swap de adaptador como los que ya viene haciendo el proyecto (`InMemoryConversationRepository` → `SupabaseConversationRepository`).

---

### ADR-019: Scheduler real — `node-cron` + persistencia JSON simple, y la regla de no disparar jobs vencidos al reiniciar

**Contexto.** P6 (`docs/17` §3.7) pide reemplazar `NoopScheduler` (seam que registra jobs pero nunca los ejecuta) por un scheduler real que dispare `TaskOrchestrator.submit()` en el horario programado. `SchedulerPort` ya existía (`schedule`/`cancel`/`list`) pero no tenía forma de ejecutar nada — el Gateway construye `TaskOrchestrator` internamente, así que el scheduler concreto no puede conocerlo en su propio constructor (problema de orden de construcción).

**Decisión.**
1. `SchedulerPort` gana `start(dispatch)`/`stop()`. `Gateway.bootstrap()` llama `scheduler.start(...)` pasando una función que audita el disparo (`action: "job.fired"`, mismo `AuditService` que ya usa `tool.execute`) y recién después llama `taskOrchestrator.submit()` — así un job programado queda en la misma auditoría, y por lo tanto en el widget "Actividad reciente" del Dashboard (P4), sin código nuevo ahí.
2. `NodeCronScheduler` (paquete `node-cron`, sin bindings nativos — instala limpio, a diferencia de `@abandonware/noble`) implementa jobs recurrentes (`cron`, con segundos opcionales) y de una sola vez (`runAt`, `setTimeout`). Valida en `schedule()`: exactamente uno de `cron`/`runAt`, cron bien formado, `runAt` estrictamente futuro — falla rápido y en voz alta, mismo criterio que el resto del proyecto (`validateAddress`/`validateHexValue` en `plugin-bluetooth-generic`, etc.).
3. Persistencia: `ScheduledJobStorePort` + `JsonFileScheduledJobStore`, mismo patrón que `JsonFileConfigStore` (edge-agent-core) y `SafetyPolicyStore` — un archivo JSON reescrito completo en cada mutación. Alcanza para docenas de jobs; no es la solución de un scheduler a escala, es la solución correcta para el volumen real esperado hoy.
4. **Regla de seguridad explícita:** un job `runAt` cuyo horario ya pasó mientras el Gateway estaba apagado **no se dispara** al reiniciar — se descarta con un warning en el log. KAN puede controlar hardware físico real (ADR-004); disparar una acción física "tarde", sin que el usuario la espere en ese momento, es peor que no dispararla. Un job `cron` sí se re-arma normal al reiniciar (su próxima ejecución sigue siendo futura por definición).

**Alternativas consideradas.**
- *Reinventar el parseo de cron a mano.* Descartado — parsear correctamente rangos/listas/steps de cron es no trivial y propenso a bugs sutiles; `node-cron` es una librería chica, sin dependencias nativas, y ya validada por uso real. Mismo criterio que ADR-011 (no reinventar lo que ya existe bien hecho y barato de adoptar).
- *Disparar retroactivamente un `runAt` vencido al reiniciar.* Descartada explícitamente — ver la regla de seguridad arriba.
- *Persistencia en Supabase en vez de un archivo local.* Prematuro: el Gateway hoy no tiene noción de usuario/sesión (vive en la LAN del Edge Agent, no en `apps/web`), y los jobs son locales a esa instancia — igual criterio que `JsonlAuditStore` ya usado para auditoría.

**Consecuencia.** Probado con temporizadores reales (ADR-012: expresiones cron con segundos y esperas cortas de verdad, no mocks de tiempo) — el mismo criterio que ya encontró bugs reales en `NodeTcpTransport`.

---

### ADR-020: Personalidad sobre `UserPreferencesPort` genérico — mismo molde que memoria, no una tabla/columna dedicada

**Contexto.** La tabla `user_preferences` existe desde P0.1 (esquema completo desde el día uno) pero no tenía ni puerto ni UI — deuda documentada, no oculta. Al mismo tiempo, `docs/17` §3.2 pedía "Personalidad" (tono, estilo, límites del `systemPrompt`) como candidato de bajo riesgo y alto impacto.

**Decisión.** `UserPreferencesPort` (CRUD completo por `key`, mismo shape que `MemoryStorePort`) + `PersonalityContextPort`/`UserScopedPersonalityContext` (puerto angosto pre-escopeado, mismo patrón que `MemoryContextPort`/`UserScopedMemoryContext`). `SendMessageUseCase` inyecta la personalidad en el `systemPrompt` igual que ya hace con la memoria — si no hay proveedor, o si `getPersonality()` falla, el chat sigue funcionando con el prompt por defecto. La UI en `/configuracion` solo expone la preferencia `personality` (un textarea libre) — el resto del store queda genérico y sin UI todavía, listo para preferencias futuras (unidades, idioma) sin otra migración.

**Por qué no una columna `personality` en `profiles` en vez de la tabla genérica.** La tabla ya existe con RLS ya configurada (`user_preferences_manage_own`) desde P0.1 — usarla es cero costo marginal de esquema, y deja la puerta abierta a preferencias futuras sin otra migración ni otro puerto. Mismo razonamiento que ya se aplicó al diseñar el esquema completo desde el principio.

**Consecuencia.** Ninguna — es aditivo puro (`personalityContext` es un 5º parámetro opcional de `SendMessageUseCase`, nada que ya lo llamaba sin él se rompe).

---

### ADR-021: Jobs con múltiples `steps` ("acciones combinadas") + notificación — no un planner con dependencias

**Contexto.** El usuario pidió extender el Scheduler (P6) para que un job pueda disparar "notificaciones o acciones combinadas". `docs/16` P5 ya había marcado un planner real (grafo de dependencias, desambiguación multi-dispositivo) como **prioridad baja / especulativo** sin un caso de uso real todavía — así que la pregunta de diseño era cómo dar esta capacidad sin construir eso.

**Decisión.** `ScheduledJob.taskRequest` (un solo paso) pasa a `ScheduledJob.steps: TaskRequest[]` (uno o más) — no un grafo, una **secuencia estricta**: se ejecutan en orden, y el primer paso que falle detiene los siguientes (mismo criterio de seguridad física que el resto del proyecto: nunca seguir a ciegas después de un fallo). Un job de un solo paso es simplemente `steps` con un elemento, sin caso especial en el código. `ScheduledJob` gana `notification?: { title, body }`, disparada después de correr los `steps` (haya fallado o no, con severidad `warning`/`info` según el resultado) — reactiva el seam `NotificationServicePort` (docs/12 §9) con su primer disparador real, tal como anticipaba `docs/17` §3.5.

**Por qué esto no es el planner que P5 de docs/16 descartó.** No hay grafo de dependencias, no hay desambiguación de "qué dispositivo", no hay branching ni condicionales — es una lista ordenada fija que el usuario arma a mano en el formulario. Sigue siendo una automatización simple, solo que con más de un paso. El día que aparezca un caso de uso real que necesite dependencias/condicionales, esa es la señal que `docs/16` pedía antes de construir el planner completo.

**Limitación conocida: `notification.userId` es `"system"`.** El Gateway no tiene noción de usuario/sesión (vive en la LAN del Edge Agent, no en `apps/web` — mismo razonamiento que ADR-019 sobre la persistencia de jobs), así que no puede saber a qué usuario de Supabase pertenece una notificación disparada por un job. Hoy `ConsoleNotificationService` es la única implementación real (solo loguea), así que el valor inmediato y visible para el usuario es el registro en auditoría (`action: "job.notification"`), que ya aparece en el widget "Actividad reciente" del Dashboard (P4) sin código nuevo ahí. Cuando el Gateway gane un mapeo real de usuario↔instancia, `notify()` empieza a funcionar de verdad sin tocar `Gateway.bootstrap()` — es un swap de adaptador, no una rearquitectura.

**Consecuencia.** Cambio de shape no retrocompatible en `ScheduledJob`/`SchedulerDispatch` (`taskRequest` → `steps`) — aceptable porque el Scheduler se construyó en esta misma sesión, sin consumidores externos todavía.

---

### ADR-022: `plugin-mqtt` — cliente de un broker existente, reconexión con período fijo (no exponencial)

**Contexto.** Siguiente incremento de hardware (P5) tras ESP32/Bluetooth: MQTT para sensores/actuadores IoT genéricos. Primera decisión de producto, confirmada explícitamente por el usuario: KAN se conecta como **cliente** a un broker MQTT que ya existe (Mosquitto, HiveMQ, etc.) — no aloja su propio broker. Es la topología estándar de IoT (el usuario ya tiene sensores publicando a un broker) y no exige infraestructura nueva de su parte.

**Decisión — modelo de dispositivo.** Un "dispositivo" (`DeviceDriverPort`) es una conexión a un broker configurado vía `KAN_MQTT_BROKERS` (URLs separadas por coma, mismo patrón que `KAN_ESP32_WIFI_HOSTS` — nunca escanea la red). Cada topic al que el usuario se suscribe (`subscribe_mqtt`) se vuelve un target direccionable por Safety Policy, mismo mecanismo que direcciones BLE/pines ESP32. `publish_mqtt` es `irreversible-material` por defecto (no sabemos qué escucha un topic, podría ser un actuador real) — mismo criterio que `write_characteristic` en `plugin-bluetooth-generic`.

**Decisión — reconexión: se apoya en `mqtt.js`, no reimplementa backoff exponencial.** A diferencia de `NodeTcpTransport` (backoff exponencial casero, tope fijo de 5 intentos), `plugin-mqtt` deja que el propio cliente `mqtt.js` reconecte (mismo objeto persiste, período **fijo** vía `reconnectPeriod` — la librería no ofrece backoff exponencial nativo) y **re-suscribe automáticamente los topics ya registrados** (`resubscribe: true`, el default, verificado contra la API real, no asumido). Reimplementar backoff exponencial a mano habría significado recrear el cliente en cada intento y perder ese resubscribe gratis — no valía la pena para lo que se ganaba. `NodeMqttTransportTuning.maxReconnectAttempts` queda como tope **opt-in, sin default** (a diferencia de TCP): un broker es infraestructura estable que puede reiniciarse por mantenimiento, no una placa que puede desaparecer para siempre — no tiene sentido "rendirse" por defecto. Cada cambio de estado expone `reconnectAttempt`/`unreachableSince` para que Core/UI puedan mostrar "sin respuesta desde HH:MM" en vez de una reconexión silenciosa e invisible.

**Decisión — caché de topics sobrevive a `disconnect()`.** Mismo criterio que `lastScan` en `plugin-bluetooth-generic`: el último valor conocido de cada topic vive en un mapa separado de la conexión viva, nunca se borra al desconectar — tiene sentido poder preguntar "¿cuál fue la última lectura?" aunque la conexión haya caído hace un momento. Las capabilities que sí hablan con el broker (`subscribe_mqtt`, `unsubscribe_mqtt`, `publish_mqtt`) sí exigen conexión viva.

**Decisión — credenciales.** Van en la URL de `KAN_MQTT_BROKERS` (mismo trust boundary que `GROQ_API_KEY`/`GEMINI_API_KEY`/`KAN_EDGE_TOKEN`, ya manejados así en el proyecto). Nunca se loguean ni aparecen en el nombre del dispositivo — `discover()` siempre redacta a `protocolo//host:puerto`.

**Alternativas consideradas.**
- *Backoff exponencial casero también para MQTT.* Descartada — ver arriba, el costo (perder resubscribe automático, más código a mantener) no se justifica frente a lo que ofrece `mqtt.js` de fábrica.
- *KAN aloja su propio broker embebido (`aedes` en producción, no solo en tests).* Fuera de alcance para esta fase — decisión de producto explícita del usuario, no técnica. `aedes` se usa exclusivamente para levantar un broker real en los tests (ADR-012), nunca como parte del plugin en producción.

**Consecuencia.** La reconexión de MQTT no tiene backoff exponencial (a diferencia de TCP) — una desviación real y documentada, no una inconsistencia accidental.

---

### ADR-023: `plugin-gcode` — extrae `@kan/serial-line-transport`, `discover()` no escanea, parar es siempre de baja fricción

**Contexto.** Siguiente incremento de hardware (P5): impresoras 3D (Marlin), CNC y láseres (GRBL) hablan G-code sobre Serial/USB. Mismo transporte físico que ya usa `plugin-esp32-arduino`, protocolo de cable distinto (texto G-code, no JSON).

**Decisión — extraer `@kan/serial-line-transport`.** `LineConnection`, `SerialTransportPort`/`PortInfo` y `NodeSerialTransport` (envoltorio de `serialport`) se movieron de `plugin-esp32-arduino` a un paquete nuevo, genuinamente compartido (segundo consumidor real, no especulativo). `FakeSerialTransport` y `wireProtocol.ts` **se quedaron** en `plugin-esp32-arduino` — están acoplados al protocolo JSON propio de KAN, no son reutilizables para G-code (que necesita su propio fake y su propio parser de respuestas "ok"/"error"). Verificado sin regresión: los 27 tests de `plugin-esp32-arduino` pasan igual después de la extracción.

**Decisión — `discover()` nunca escanea puertos sin configurar.** A diferencia de ESP32 (que puede escanear todos los puertos seriales porque su propio firmware responde un "ping" JSON inofensivo que cualquier otro dispositivo simplemente ignora), Marlin y GRBL no comparten un comando de identificación común — no hay forma universal de confirmar "esto es una máquina G-code de verdad" sin asumir un firmware específico. Mandarle texto G-code a un puerto serial desconocido es un riesgo real (podría ser cualquier otro dispositivo). `KAN_GCODE_PORTS` es obligatorio; `discover()` solo confirma que el puerto configurado abre, no que hable G-code — límite real, documentado en el README, no un descuido.

**Decisión — severidad: parar es siempre `reversible`, encender el spindle/láser es `safety-critical`.** `emergency_stop`/`stop_spindle_or_laser` nunca deben quedar detrás de una confirmación — en una emergencia real, la acción de parar tiene que ejecutarse con la menor fricción posible, no la mayor. `start_spindle_or_laser` usa `safety-critical` (el techo de `ActionSeverity`, primera vez que se usa en el proyecto) en vez de `irreversible-material`: encender un láser o un spindle es, literalmente, el ejemplo de "podría lastimar a alguien" que se repite desde ADR-004 — merece la severidad más alta disponible, no la misma que mover un eje.

**Decisión — `M104`/`M140` en vez de `M109`/`M190` para temperatura.** Las variantes "esperar hasta alcanzar" pueden tardar minutos — no encajan en un modelo de capability de request/response con timeout corto. `set_temperature` fija el objetivo y devuelve de inmediato; consultar si ya se alcanzó queda para `get_position`/una capability futura si aparece el caso de uso.

**Consecuencia.** `move_axis` solo soporta movimiento relativo (`G91`/`G0`/`G90`), nunca a coordenadas absolutas — decisión deliberada para evitar mover la máquina a una posición inesperada si el estado de posicionamiento asumido no coincidía con el real.

### ADR-024: `inputSchema` pasa a JSON Schema real, validado en dos capas — sin tocar `plugin-sdk-ts`

**Contexto.** `docs/16` P1 señalaba desde el cierre de v0.1 que `CapabilityDescriptor.inputSchema` era un objeto informal (`{ distanceMm: "number" }`) que ningún componente del Core validaba en runtime — cada plugin repetía a mano su propia validación de tipos (`typeof pin !== "number"`, etc.), sin garantía de que el próximo plugin lo hiciera bien. `GeminiProvider.toGeminiSchema()` ya convertía ese formato informal a JSON Schema real para el SDK de Gemini, pero solo para informarle la forma al LLM, nunca para validar. Con cinco plugins de hardware ya construidos (simulador, ESP32, Bluetooth, MQTT, G-code) y P7 (apps móviles) como siguiente frente de superficie nueva, esta era la deuda de seguridad marcada explícitamente como "sin motivo para posponerla más" (`VISION_PRODUCT_v0.2.md`).

**Decisión — JSON Schema real con `ajv`, no `zod`.** `CapabilityDescriptor.inputSchema`/`ToolDescriptor.inputSchema` (`@kan/plugin-contract`) pasan a un tipo `JsonSchema` (subconjunto tipado: `type`/`properties`/`required`/`items`/`enum`) y se validan con `ajv.compile()` vía `validateAgainstSchema()`, nueva función exportada desde `@kan/plugin-contract`. Se prefirió `ajv` directo sobre `zod` + `zod-to-json-schema` (la otra opción que proponía `docs/16` P1) porque cada capability ya declaraba su forma como un objeto plano pensado para convertirse en JSON Schema — compilar ese objeto directo con `ajv` es un paso, mientras que `zod` habría exigido reescribir ~20 declaraciones de capability como schemas `zod` para luego reconvertirlas a JSON Schema, un nivel de indirección sin beneficio real aquí. Como consecuencia directa, `GeminiProvider.toFunctionDeclaration()` se simplifica: ya no necesita `toGeminiSchema()`/`mapSchemaType()` (la conversión heurística desaparece), `inputSchema` viaja tal cual a `parametersJsonSchema`.

**Decisión — dos capas de validación en las fronteras de confianza reales, no en `plugin-sdk-ts`.** `docs/16` P1 proponía que `plugin-sdk-ts` validara "antes de llamar a `plugin.invoke()`". Al implementar, `KanDeviceDriverPlugin.invoke()` es un método abstracto que cada plugin implementa directo — no hay un punto de envoltura en el SDK donde interceptar la llamada sin forzar a todos los plugins existentes a renombrar su método (`invoke` → algo como `performInvoke`), un cambio de contrato más grande de lo que la deuda técnica ameritaba. En cambio, la validación se ubicó en los dos puntos donde **todas** las invocaciones ya convergen, sin excepción:
1. `ToolResolver.resolve()` (`packages/gateway-core`) — valida los `args` que propone el LLM antes de que `Gateway.executeTool()` los despache al `TaskOrchestrator`. Es la frontera LLM↔Gateway.
2. `CapabilityRegistry.invoke()` (`packages/edge-agent-core`) — valida de nuevo antes de resolver severidad (`SafetyPolicyStore.resolveSeverity()`) o tocar el driver. Es la frontera Gateway↔Edge Agent, y cubre también invocaciones que no vinieron del LLM (ej. los botones "Invocar" de `apps/desktop`, que llaman `CapabilityRegistry.invoke()` igual). Un input inválido no lanza excepción — devuelve `{ status: "executed", result: { success: false, error } }`, el mismo shape que cualquier otro fallo de ejecución, para no convertir un caso esperado y frecuente (un LLM mandando argumentos con forma incorrecta) en una ruta de excepción sin manejar (`EdgeAgent.handleCoreMessage()` no envuelve `capabilityRegistry.invoke()` en `try/catch` — ver limitación conocida más abajo).

**Decisión — el schema cubre forma y tipos básicos, no reglas de negocio.** Los schemas declarados (ej. `write_analog_pin: { pin: number, value: number }`) no incluyen `enum`/`minimum`/`maximum`/`pattern` aunque JSON Schema los soporte — esas reglas (rango 0-255 de un PWM, formato hexadecimal de un valor BLE, `axis` restringido a X/Y/Z) siguen viviendo en los validadores propios de cada plugin (`validateAnalogValue`, `validateHexValue`, `validateAxis`...), que ya daban mensajes de error específicos y en español antes de este incremento. Subir esas reglas al schema habría dado un mensaje de `ajv` genérico ("must be <= 255") en vez del mensaje de dominio ya probado, sin ganar nada real — la capa de schema resuelve exactamente el problema que tenía (ausencia de validación de forma), no reemplaza el juicio del plugin sobre su propio dominio.

**Alternativas consideradas.**
- *`zod`/`zod-to-json-schema`.* Descartada — ver arriba, indirección sin beneficio dado que las capabilities ya se piensan como JSON Schema plano.
- *Envolver `invoke()` en `plugin-sdk-ts` (tal como sugería `docs/16` literalmente).* Descartada — habría exigido renombrar el método abstracto en los cinco plugins existentes para dejar `invoke()` libre como wrapper, un costo de refactor no proporcional al problema que resuelve esta validación.
- *Lanzar una excepción en `CapabilityRegistry.invoke()` ante un schema inválido, igual que ante una capability desconocida.* Descartada explícitamente — un nombre de capability desconocido es un error de protocolo (no debería ocurrir si `ToolResolver` ya lo validó), mientras que args con forma inválida es un caso legítimo y frecuente (el LLM se equivoca de tipo). Tratarlo como excepción sin manejar en `EdgeAgent.handleCoreMessage()` habría sido peor que el problema que se resolvía.
- *Subir las reglas de negocio de cada plugin al JSON Schema (`enum`, `minimum`/`maximum`, `pattern`).* Descartada por ahora — ver la tercera decisión arriba.

**Consecuencia.** `packages/plugin-contract` gana su primera dependencia real de terceros (`ajv`) — hasta ahora era un paquete de solo tipos/vocabulario compartido. Es una dependencia pequeña, sin bindings nativos, coherente con el criterio ya aplicado a `node-cron` (ADR-019) y `mqtt.js` (ADR-022): no reinventar validación de JSON Schema a mano. **Limitación conocida:** `EdgeAgent.handleCoreMessage()` sigue sin `try/catch` alrededor de `capabilityRegistry.invoke()` — preexistente a este incremento (una capability/dispositivo desconocido ya podía lanzar ahí), no introducido por él; justamente por eso la validación de schema se diseñó para no lanzar y no agravar ese punto.

### ADR-025: `audit.local` fire-and-forget (sin cola nueva) + rate limiting/cap de conexiones como límites globales

**Contexto.** Tras ADR-024, se cerraron dos ítems de bajo costo de `docs/16`: **P4** (las acciones disparadas desde los botones "Invocar" de `apps/desktop` no dejaban rastro en `audit.jsonl` del Gateway — solo lo que dispara el LLM vía `ToolExecutor` quedaba auditado) y **P6** (el Gateway no tenía límite de requests HTTP por unidad de tiempo ni de conexiones WebSocket concurrentes). P2 (auth/autorización por usuario en el Gateway) se dejó deliberadamente aparte por ser de varios días, no un quick win.

**Decisión — P4, alcance limitado a `invokeCapability()`, sin cola de reintentos.** Nuevo mensaje de protocolo `AuditLocalMessage` (`packages/plugin-contract/src/protocol.ts`), enviado por `EdgeAgent.invokeCapability()` (nunca por `handleCoreMessage()`, que ya audita del lado del Gateway como actor `"llm"` vía `ToolExecutor`) cuando la invocación se ejecuta de inmediato (`outcome.status === "executed"`). El Gateway lo recibe en el mismo `connectionManager.onMessage(...)` donde ya vive `safety_policy.changed` y lo registra con `actor: "user"`. Al implementar se encontró que la premisa de `docs/16` P4 — "si el Edge Agent está offline, se encola igual que cualquier otro dato pendiente de sincronizar (Modo Offline, ya diseñado)" — **no corresponde a código real**: `CoreWebSocketClient.send()` es fire-and-forget puro, sin buffer, para cualquier tipo de mensaje; no existe ninguna cola de sincronización offline en el repositorio (ver también el diagrama de `docs/01-arquitectura-general.md`, igualmente aspiracional en ese punto). `audit.local` hereda ese mismo comportamiento — igual que `safety_policy.changed`, ya en producción con la misma limitación — en vez de construir una cola nueva que sería, en sí misma, un proyecto aparte y no un quick win.

**Decisión — P4, una acción peligrosa manual pendiente de confirmación no se audita todavía.** Cuando una capability manual queda `pending_confirmation`, la ejecución real ocurre después en `CapabilityRegistry.executeConfirmed()` (disparado por `EdgeAgent.resolveConfirmation()`, el modal de confirmación de `apps/desktop`). Cubrir ese camino también es viable pero exige que `executeConfirmed()`/`InvokeOutcome` expongan `deviceId`/`capabilityName` en su resultado — hoy no los tienen — lo que rompe el shape exacto que varias aserciones `.toEqual` de `CapabilityRegistry.test.ts` verifican. Confirmado explícitamente con el usuario: se deja fuera de este incremento. **Limitación conocida:** confirmar o rechazar manualmente una acción `irreversible-material`/`safety-critical` desde `apps/desktop` no genera todavía una entrada de auditoría en el Gateway — es la brecha de auditoría que queda más grande tras este incremento, justo en las acciones de mayor riesgo. Candidato natural para un incremento futuro, no resuelto aquí a propósito.

**Decisión — P6, cap global de conexiones, no "por token".** `docs/16` P6 proponía un límite "por token" en `WsConnectionManager`, pero el Gateway solo tiene un único token compartido (`KAN_EDGE_TOKEN`) para todos los Edge Agents — no existe identidad por token hoy. El cap implementado (`WsConnectionManager`, constructor con `maxConnections`, default 50) es en la práctica un **límite global de conexiones concurrentes** (pendientes de `hello` + ya identificadas), aplicado en `handleUpgrade()` antes de delegarle el socket a `ws`. Protege contra el vector real: alguien con el token válido abriendo muchas conexiones que nunca completan `hello` (quedan en `pending` hasta el timeout de 10s), agotando recursos del proceso. No reemplaza P2 — sigue sin haber aislamiento por identidad, solo un tope de recursos.

**Decisión — P6, rate limiting HTTP con `express-rate-limit`, antes del chequeo de token.** `apps/gateway`'s `createRoutes()` gana un middleware de `express-rate-limit` (120 req/min por IP por defecto, configurable vía `KAN_GATEWAY_RATE_LIMIT_WINDOW_MS`/`KAN_GATEWAY_RATE_LIMIT_MAX`) aplicado **antes** del middleware de autenticación — así también acota intentos de fuerza bruta contra el token interno, no solo tráfico ya autenticado. El default se calibró contra el tráfico real conocido (`apps/web`'s `useSystemStatus.ts` sondea cada 15s ⇒ 4 req/min, más varias llamadas de function-calling por turno de chat), con margen amplio.

**Alternativas consideradas.**
- *Construir la cola de "Modo Offline" como parte de P4, ya que la documentación la daba por existente.* Descartada — es un proyecto de infraestructura aparte (qué se reintenta, en qué orden, con qué límite de reintentos, persistido dónde), desproporcionado para un incremento de medio día. Se corrige la documentación en vez de inflar el alcance para que coincida con ella.
- *Auditar también la resolución de confirmaciones manuales en este incremento.* Descartada por ahora — ver la limitación conocida arriba.
- *Rate limiting por identidad de usuario en vez de por IP.* Descartada — no hay identidad de usuario en el Gateway todavía (ese es exactamente el problema que resuelve P2); por IP es lo único disponible sin esa infraestructura, y es consistente con el criterio de "cap global de recursos" de esta misma decisión.

**Consecuencia.** `apps/gateway` gana su primera dependencia de rate limiting (`express-rate-limit`, sin bindings nativos). Ninguna de las dos decisiones toca el modelo de permisos ni la Safety Layer — son hardening de infraestructura (audit trail, resource exhaustion), no cambios de seguridad de acciones físicas.

### ADR-026: Persistencia real del audit trail (Supabase) — `AuditStorePort` pasa a async, y primer uso de la `service_role` key del proyecto

**Contexto.** `docs/16` P3 (`docs/16-arquitectura-propuestas-v0.1.md`): el audit trail del Gateway (`AuditStorePort` → `JsonlAuditStore`) vivía solo en un archivo `.jsonl` local del proceso, sin réplica — un fallo de disco o de la VM pierde todo el historial de auditoría. La propuesta original asumía que "los puertos ya están diseñados para este swap sin tocar el dominio", pero al implementar apareció un obstáculo real que la propuesta no había anticipado.

**Decisión — `AuditStorePort` pasa a async, sin cambiar la firma pública de `AuditService.record()`.** `append(entry): void`/`list(filter?): AuditEntry[]` no pueden cumplirse con un adaptador real que hace *network I/O* — se vuelven `Promise<void>`/`Promise<AuditEntry[]>`. El blast radius se mantuvo mínimo porque `AuditService.record()` sigue sin esperar `store.append(full)` (exactamente el mismo criterio "best-effort, nunca bloquea el flujo que audita" que `JsonlAuditStore` ya aplicaba) — los 4 call sites de `Gateway.bootstrap()` que llaman `auditService.record(...)` no cambiaron una línea. Solo `AuditService.list()` pasó a `async`, con un único consumidor real (`GET /v1/audit` en `apps/gateway/src/http/routes.ts`), trivial de volver `async` — su fake en `routes.test.ts` (`list: () => [...]`, síncrono) siguió funcionando sin tocarlo: un `await` sobre un valor no-Promise se resuelve igual. `JsonlAuditStore` se actualizó al mismo contrato (wrap trivial, mismo cuerpo) y sigue exportada y testeada — deja de ser la que instancia `apps/gateway`, mismo criterio que `InMemoryConversationRepository` tras ADR-007.

**Decisión — `service_role` key para el Gateway, `audit_entries` con RLS activado y sin ninguna policy.** El Gateway es un proceso backend sin sesión de usuario — no hay `auth.uid()` para que las RLS policies del resto del esquema (basadas en `auth.uid() = user_id`) apliquen. Confirmado explícitamente con el usuario entre dos alternativas: (a) `service_role` key + tabla sin policies para `anon`/`authenticated` (deny-by-default real — nadie con la `anon` key pública, que vive en el bundle de `apps/web`, puede leer ni escribir ahí), o (b) mantener solo `anon` key con una policy de insert abierta. Se eligió (a): la `anon` key es pública por diseño, y una policy de insert sin `auth.uid()` habría dejado el propio registro de auditoría — la pieza que existe para dar trazabilidad de seguridad — escribible por cualquiera que inspeccionara el bundle del navegador y llamara directo a la API REST de Supabase, sin pasar nunca por el Gateway ni sus tokens (`KAN_EDGE_TOKEN`/`KAN_GATEWAY_INTERNAL_TOKEN`). Es el primer uso de `service_role` en el proyecto — ADR-017 había evitado necesitarla explícitamente ("no se requiere... ninguna operación necesita saltarse RLS todavía") — pero es exactamente el caso legítimo que la justifica: un backend de confianza sin sesión de usuario, escribiendo en una tabla sin concepto de dueño, con la key guardada en una variable de entorno server-only (`KAN_SUPABASE_SERVICE_ROLE_KEY`) que jamás llega a un cliente/navegador (a diferencia de `NEXT_PUBLIC_SUPABASE_ANON_KEY` en `apps/web`, pública por diseño).

**Decisión — `SupabaseAuditStore.list()` ordena por `at` descendente y acota a 500 filas.** `JsonlAuditStore.list()` devolvía literalmente todo el historial (acotado solo por la RAM del proceso). Una tabla Postgres puede crecer sin ese límite natural, y el único consumidor real (`apps/web`'s `/api/status`, `RECENT_ACTIVITY_LIMIT = 10`) ya trunca y reordena del lado del cliente — un tope defensivo de las 500 filas más recientes no cambia ningún comportamiento visible, solo evita traer una tabla sin límite en cada poll del Dashboard. No es un cambio de contrato del puerto (`list()` sigue devolviendo `AuditEntry[]` filtrado por `actor`/`action`/`subject`), es una decisión interna del adaptador.

**Alternativas consideradas.**
- *Mantener `anon` key + policy de insert abierta para `audit_entries`.* Descartada — ver la decisión de credencial arriba; debilitaría la integridad del propio audit trail.
- *Cambiar `AuditService.record()` a `async` para poder esperar y propagar errores de escritura.* Descartada — habría significado que un fallo transitorio de red hacia Supabase pudiera retrasar o hacer fallar `tool.execute`, un cambio de Safety Policy, o el disparo de un job, todos flujos que no deberían depender de que la auditoría tenga éxito. `SupabaseAuditStore.append()` captura sus propios errores y los loguea (`console.error`), igual que `JsonlAuditStore` ya hacía con fallos de disco.
- *Paginación/cursor real en `AuditStorePort.list()` en vez de un `LIMIT` fijo en el adaptador.* Prematuro — ningún consumidor pide más de 10 entradas hoy; se revisita si aparece un caso de uso real (ej. una vista de auditoría completa en el Dashboard).

**Consecuencia.** `@kan/supabase-adapter` gana su primera dependencia cruzada de otro paquete de puertos (`@kan/gateway-core`, además de `@kan/core`) — mismo rol, distinto dueño de los puertos que implementa. `apps/gateway` pasa a requerir credenciales de Supabase para arrancar (`requireEnv` falla rápido y en voz alta si faltan, mismo criterio que el resto del proyecto) — antes no tenía ninguna dependencia de Supabase.

### ADR-027: Streaming del chat a nivel de loop (no intra-capability) + fix del descalce de timeouts que impedía completar `home_axes`

**Contexto.** `docs/16` P7: `/api/chat` devolvía un único JSON al terminar todo el loop de function-calling — con capabilities reales (ESP32/MQTT/G-code) que ya pueden tardar segundos, el usuario miraba "KAN está pensando…" sin ninguna señal intermedia hasta 45s. La propuesta decía "el Gateway ya tiene la pieza que falta: `TaskOrchestrator` descarta la telemetría `"progress"`, literalmente reservada para esto". Al investigar aparecieron dos hallazgos que la propuesta no había anticipado.

**Hallazgo 1 — el seam de `"progress"` está vacío en los dos extremos, no solo del lado Gateway.** Nadie emite nunca `status: "progress"` — ni el Edge Agent ni ningún plugin (verificado con grep en todo el repo). `TelemetryMessage` tampoco tiene un shape para progreso incremental (`percent`/`step`), solo el `data: unknown` genérico que ya usa `"done"`. Construir progreso real *dentro* de la ejecución de una sola capability habría exigido: protocolo Core↔Edge Agent nuevo, cambios en cada plugin para reportar avance parcial, cambios en `CapabilityRegistry`/`ToolExecutor`/`Gateway.executeTool()` para no resolver en una sola respuesta, y un `GatewayToolProvider`/`ToolProviderPort` capaces de consumir múltiples actualizaciones por invocación — una reescritura de varias capas, muy por encima del "costo medio" que estimaba `docs/16`.

**Decisión — streaming a nivel del loop de `SendMessageUseCase`, no intra-capability.** Se transmiten los eventos que el loop ya produce de forma natural: *tool propuesta → tool ejecutándose (implícito, es la espera de la siguiente) → tool completada → respuesta final*. `SendMessageUseCase.execute()` gana un segundo parámetro opcional, `onEvent?: (event: ChatStreamEvent) => void` (`ChatStreamEvent = "tool_call" | "tool_result" | "final"`) — aditivo, mismo criterio que `personalityContext`/`memoryContext` (parámetros opcionales, ADR-020): los 11 tests existentes no pasan el callback y siguen pasando sin cambios. `apps/web/app/api/chat/route.ts` pasa de `NextResponse.json(...)` a un `ReadableStream` con `Content-Type: text/event-stream`; la validación de body/imagen y la construcción del caso de uso (que puede lanzar `MissingApiKeyError`) se mantienen *antes* de abrir el stream, así que los errores de configuración más comunes siguen devolviendo un status HTTP normal (400/412) en vez de viajar dentro del stream. `ToolProviderPort.executeTool()` sigue siendo una única espera bloqueante — lo que cambia es que el usuario ve "🔧 Llamando a toggle_led…" en cuanto arranca esa espera, no un spinner genérico durante los 90s completos. La línea `if (message.status === "progress") return;` en `TaskOrchestrator.handleTelemetry()` queda exactamente igual — sigue siendo un seam reservado y sin uso, esta vez documentado explícitamente como tal en vez de asumido como "la pieza que falta".

**Hallazgo 2 — `home_axes` (el caso de 30s+ que motivó este pedido) ya fallaba antes de llegar a completarse, sin relación con el streaming.** `TaskOrchestrator.submit()` tenía `TASK_TIMEOUT_MS = 15_000`, pero `plugin-gcode`'s `home_axes` (`HOME_TIMEOUT_MS = 30_000`) puede tardar el doble en el propio Edge Agent. Cualquier invocación de `home_axes` desde el chat ya fallaba con "Timeout esperando respuesta del Edge Agent" a los 15s — un bug preexistente e independiente de este incremento. Confirmado explícitamente con el usuario: se arregla en la misma pasada, porque sin esto el streaming solo mostraría más prolijo el mismo fallo para el caso exacto que motivó pedirlo.

**Decisión — subir los tres timeouts en cadena, mismo criterio "cada capa espera más que la anterior" ya usado (comentario existente citando hallazgo A7 de docs/13).**
- `TaskOrchestrator.TASK_TIMEOUT_MS`: 15_000 → **40_000** (cubre `HOME_TIMEOUT_MS`=30s + margen de red/dispatch).
- `GatewayToolProvider.EXECUTE_TOOL_TIMEOUT_MS`: 20_000 → **45_000** (debe seguir por encima del timeout del Gateway).
- `SendMessageUseCase.MAX_TOTAL_DURATION_MS`: 45_000 → **90_000** (presupuesto para una tool call lenta más una ronda final del LLM).

**Riesgo documentado, no resuelto en este incremento:** si `apps/web` corre en un plan de Vercel con límite de duración de función serverless corto, un presupuesto total de 90s podría exceder ese límite en el peor caso (una `home_axes` real). No es verificable desde este entorno de desarrollo — queda como validación pendiente contra el plan de despliegue real.

**Verificación manual realizada.** Con el dev server de `apps/web` corriendo y `GEMINI_API_KEY` real configurada (sin Gateway disponible en este entorno — `listTools()` falla gracioso, como ya estaba diseñado), se confirmó contra la API real: `POST /api/chat` devuelve `Content-Type: text/event-stream` con chunks `data: {"type":"final",...}` seguido de `data: {"type":"done","conversation":{...}}`; una request inválida (`message` faltante) sigue devolviendo `400` JSON normal, no un stream. No se pudo probar el camino `tool_call`/`tool_result` en vivo (requiere Gateway + Edge Agent + dispositivo real, no disponibles en este entorno) — cubierto por los tests unitarios de `SendMessageUseCase.test.ts` en su lugar.

**Alternativas consideradas.**
- *Async generator (`async *execute()`) en vez de callback opcional.* Descartada — habría roto el call-site de los 11 tests existentes (todos harían falta reescribir para drenar el generador), sin necesidad real dado que el callback opcional logra lo mismo con cero cambios a las llamadas existentes.
- *Emitir `progress` real construyendo el protocolo completo intra-capability.* Descartada por ahora — ver Hallazgo 1. Se revisita si aparece un caso de uso que lo justifique (ej. una impresión 3D con progreso real en % que valga la pena mostrar).
- *Dejar el fix de timeouts para un incremento aparte.* Descartada explícitamente por el usuario — sin él, este incremento no resuelve el problema que lo motivó.

**Consecuencia.** Primer uso de `ReadableStream`/SSE en `apps/web` — no hay otro precedente en el repo. `apps/web/lib/chat/parseSseStream.ts` (nuevo) separa el parseo de líneas SSE (`parseSseChunk`, puro) del consumo real (`readSseStream`, un async generator sobre `Response`), pensado para quedar testeable aislado el día que `apps/web` tenga un test runner — hoy no lo tiene (sin script `test` en su `package.json`), por eso la verificación de la UI fue manual.

### ADR-028: `LoggerPort` relocalizado a `@kan/plugin-contract` — `gateway-core` deja de usar `console.*` directo

**Contexto.** `docs/16` P8, la última tarea de higiene pura del documento (marcada explícitamente "muy baja prioridad, no resuelve ningún bug ni riesgo real"): `packages/edge-agent-core` ya tenía un `LoggerPort` testeable (con `FileAndConsoleLogger` como único adaptador real), pero `packages/gateway-core` y `apps/gateway` seguían usando `console.log`/`console.error`/`console.warn` directo — funcionaba, pero no era consistente con el patrón ya establecido, y no había forma de verificar qué se logueaba en un test.

**Decisión — el contrato se relocaliza a `@kan/plugin-contract`, no `gateway-core` importándolo desde `edge-agent-core`.** `LoggerPort`/`LogLevel` (4 métodos: `debug/info/warn/error(message, meta?)`, sin cambios de forma) pasan a vivir en `packages/plugin-contract/src/logger.ts` — el paquete neutral del que ya dependen tanto `gateway-core` como `edge-agent-core`, mismo criterio que ya se aplicó con `AuditStorePort`↔`@kan/gateway-core` en ADR-026 (`@kan/supabase-adapter` importándolo desde el dueño real de ese puerto, no al revés). La alternativa — que `gateway-core` dependiera directamente de `@kan/edge-agent-core` para reusar su `LoggerPort` — habría creado un acoplamiento cruzado entre dos paquetes de dominios distintos (Gateway Cloud vs. Edge Agent) que no tiene ninguna otra razón de existir. `packages/edge-agent-core/src/domain/ports/LoggerPort.ts` queda como un simple re-export (`export type { LoggerPort, LogLevel } from "@kan/plugin-contract";`) — los ~10 archivos internos de ese paquete que ya importaban desde esa ruta relativa no cambiaron una línea, y nada fuera del paquete importaba `LoggerPort` por nombre (`apps/desktop` solo usa la clase concreta `FileAndConsoleLogger`, con el tipo del puerto inferido estructuralmente).

**Decisión — `ConsoleLogger` (Gateway) no replica el archivo local ni el bus de `FileAndConsoleLogger` (Edge Agent).** `FileAndConsoleLogger` escribe a un archivo local y emite cada entrada al `EdgeAgentBus` para que la UI de `apps/desktop` muestre logs en vivo — ninguna de las dos cosas tiene un consumidor real del lado del Gateway: no hay UI que muestre logs en vivo del Gateway, y ya persiste su propio audit trail aparte (`AuditService`/`SupabaseAuditStore`, ADR-026) — un archivo de log adicional sería una segunda fuente de verdad redundante. `ConsoleLogger` (`packages/gateway-core/src/infra/`) es deliberadamente más simple: formatea `[timestamp] [NIVEL] mensaje` y despacha al método de `console` correspondiente, nada más.

**Decisión — logger como último parámetro opcional con default, en todos los constructores tocados.** `JsonlAuditStore`, `NoopScheduler`, `ConsoleNotificationService` y `NodeCronScheduler` (los 4 únicos archivos de `gateway-core` que usaban `console.*`, confirmado por grep exhaustivo del paquete — `AgentRegistry`, `GlobalCapabilityRegistry`, `TaskOrchestrator`, `AuditService` y `WsConnectionManager` no loguean nada hoy y no se tocaron) ganan `logger: LoggerPort = new ConsoleLogger()` como último parámetro — mismo criterio aditivo ya usado repetidamente (ADR-020, ADR-024): los ~20 call sites existentes en tests siguen construyendo estas clases con un solo argumento posicional, sin necesidad de actualizarlos. `apps/gateway/src/server.ts` construye un único `ConsoleLogger` compartido y lo pasa a los 13 call sites que antes usaban `console.*` directo (9 handlers de `bus.on(...)`, el callback de `httpServer.listen`, `shutdown()`, y los handlers de `uncaughtException`/`unhandledRejection`), además de inyectarlo en `NodeCronScheduler` y `ConsoleNotificationService`.

**Alternativas consideradas.**
- *`gateway-core` dependiendo de `@kan/edge-agent-core` para reusar su `LoggerPort` tal cual.* Descartada — acoplamiento cruzado entre dominios sin otra razón de ser; ver decisión arriba.
- *Reusar `FileAndConsoleLogger` en el Gateway.* Descartada — arrastraría un archivo de log local y una dependencia del `EdgeAgentBus` que el Gateway no tiene ni necesita.
- *Inyectar el logger en `Gateway.ts`/`GatewayDeps` para que esté disponible en toda la composición.* Descartada — ninguna de las clases que `Gateway` construye internamente (`AgentRegistry`, `GlobalCapabilityRegistry`, `TaskOrchestrator`, `AuditService`) loguea nada hoy; agregar un parámetro sin ningún uso real habría sido especulativo.
- *Extender el alcance a `packages/supabase-adapter`'s `SupabaseAuditStore.append()`* (un `console.error` agregado en ADR-026, P3). Descartada por ahora — es un paquete distinto, sin dependencia hoy de `@kan/plugin-contract`, y el proposal original de `docs/16` P8 nunca lo mencionó (es de un incremento posterior a cuando se escribió el documento). Queda como inconsistencia conocida y documentada, no resuelta en este incremento.

**Consecuencia.** Ninguna — es un cambio 100% aditivo y de infraestructura interna, sin impacto en comportamiento observable (los mensajes de log son los mismos, solo cambia el canal). Demostrado con un test nuevo en `NodeCronScheduler.test.ts` que inyecta un `LoggerPort` falso y verifica que el warning de "job vencido descartado" se dispara — antes de este incremento, ese aviso solo era visible en la salida de consola, no verificable en un test.

### ADR-029: `/api/chat` acepta `Authorization: Bearer <token>` además de cookies (prerrequisito de la app móvil)

**Contexto.** `docs/18` (propuesta de arquitectura móvil, roadmap P7): `buildSendMessageUseCase()` (`apps/web/lib/chat/composition.ts`) solo reconoce sesión vía `getCurrentUserCached()`, que depende enteramente de `@supabase/ssr` y cookies. Un cliente React Native no tiene cookies de navegador que mandar — su sesión de Supabase vive en `AsyncStorage`/`SecureStore`, y el mecanismo estándar para que un backend la reconozca es el `access_token` (JWT) de esa sesión viajando en el header `Authorization`. Sin esto, la app móvil podía hablar con `/api/chat` (confirmado que la ruta no exige sesión, ADR-017/composition.ts ya la hace opcional) pero **siempre** caería al fallback sin sesión — conversación en memoria, sin persistencia, memoria ni personalidad — aunque el usuario esté logueado en la app.

**Decisión.** La resolución de usuario en `apps/web` gana una segunda vía, evaluada antes que las cookies: si la request trae `Authorization: Bearer <token>`, se valida ese JWT contra Supabase (`supabase.auth.getUser(token)`, con la `anon key` — mismo criterio de ADR-017 de no requerir `service_role` para esto) y se usa ese usuario. Si no hay header, el comportamiento es exactamente el de siempre (cookies vía `@supabase/ssr`, sin cambios). El camino de cookies no se toca — es una rama adicional, no un reemplazo, así que ningún consumidor existente (`apps/web` mismo) se ve afectado.

**Alternativas consideradas.**
- *Que la app móvil arme cookies falsas para simular un browser.* Descartada — fragile y no es el mecanismo real de sesión de un cliente no-browser; además `@supabase/ssr` espera cookies con un formato específico atado al ciclo de vida de Next.js.
- *Que la app móvil no tenga persistencia de conversación del lado servidor y guarde todo localmente.* Descartada como default — rompería la paridad de "seguir la misma conversación desde cualquier dispositivo" que ya tiene la sesión de usuario en web.

**Consecuencia.** `apps/web/lib/chat/composition.ts` (o el helper de sesión del que depende) gana una función que intenta primero el header, después las cookies — el resto de la cadena (`SendMessageUseCase`, `@kan/supabase-adapter`) no cambia, ya que reciben un `userId` resuelto, sin conocer cómo se resolvió.

### ADR-030: `parseSseChunk` se extrae de `apps/web` a `@kan/core` (compartido con la app móvil)

**Contexto.** `docs/18`: el parseo de chunks SSE construido para el streaming del chat (ADR-027) vive en `apps/web/lib/chat/parseSseStream.ts`, con dos partes de naturaleza distinta — `parseSseChunk(buffer)` (pura, sin ninguna dependencia de DOM/browser) y `readSseStream(response)` (atada a `response.body.getReader()` de un `Response` concreto). La app móvil necesita el mismo parseo, pero con su propio `readSseStream` (recibiendo el `Response` de `expo/fetch`, no el del navegador — necesario porque el `fetch` nativo de React Native sobre Hermes todavía no soporta `ReadableStream` de forma completa, ver `docs/18` §3).

**Decisión.** `parseSseChunk` se mueve a `@kan/core` (mismo paquete que ya define `ChatStreamEvent`, el tipo que estos chunks transportan) — genuinamente compartido, no especulativo: es el segundo consumidor real, mismo criterio que ya se usó para extraer `@kan/serial-line-transport` (ADR-023). `readSseStream` se queda en cada plataforma (`apps/web`, y su futuro equivalente en `apps/mobile`), ya que es la única parte atada al runtime de `fetch` de cada una.

**Alternativas consideradas.**
- *Duplicar el parser en `apps/mobile` cuando se construya.* Descartada — es exactamente el tipo de lógica que el monorepo existe para compartir (ADR-002), y ya está escrita y probada.

**Consecuencia.** `apps/web/lib/chat/parseSseStream.ts` pasa a re-exportar `parseSseChunk` desde `@kan/core` (o `apps/mobile`, cuando exista, la importa igual) en vez de definirla — sin cambio de comportamiento.

### ADR-031: tokens de diseño duplicados a propósito entre `apps/web` y `apps/mobile`, no un paquete compartido todavía

**Contexto.** `docs/18` §4: `apps/web` usa Tailwind v4 (config CSS-first, `@theme` dentro de `globals.css`, sin `tailwind.config.js`), pero NativeWind v4 — la versión estable, production-ready, la que se usa en `apps/mobile` — todavía espera el formato v3 (`tailwind.config.js` en JS). No existe hoy una forma de que ambos formatos lean de una única fuente sin una herramienta de generación adicional.

**Decisión.** Se acepta la duplicación consciente de los valores de `DESIGN_SYSTEM.md` (documentados una sola vez ahí, copiados a mano al `tailwind.config.js` de `apps/mobile`) en vez de construir un paquete `packages/design-tokens` con generación de ambos formatos.

**Alternativas consideradas.**
- *Paquete `packages/design-tokens` (JSON/TS) que genera tanto el CSS `@theme` como el `tailwind.config.js`.* Descartada por ahora — sobre-ingeniería para 12 colores y 3 radios; se revisita si el número de tokens crece significativamente o si NativeWind v5 (que sí alinea con el formato CSS-first) se vuelve el default.

**Consecuencia.** Mismo precedente que ya existe con `apps/desktop`, que tampoco comparte hoy los tokens de `apps/web` (`DESIGN_SYSTEM.md`, sección de alcance) — cambiar el color de acento, por ejemplo, requiere editarlo en dos lugares hasta que se revisite esta decisión.

### ADR-032: subida de audio por `XMLHttpRequest`, no `expo/fetch` — y síntesis de voz sin forzar una voz específica

**Contexto.** `docs/18` §5 (incrementos 4-5, voz e imagen en la app móvil): la entrada de voz necesita subir el archivo grabado a `/api/voice/transcribe` como `multipart/form-data`. El streaming del chat (ADR-027) ya usa `expo/fetch` — la tentación natural era reusar el mismo mecanismo también para esta subida, ya que es el fetch "oficial" del proyecto para todo lo que toca a `apps/web`.

**Decisión — `XMLHttpRequest`, no `expo/fetch`, para subir el audio grabado.** Investigación externa encontró bugs reales y documentados en `expo/expo` sobre el manejo de `FormData` con archivos/`Blob` en nativo dentro de `expo/fetch` (issues #33134 y #40059, el segundo reproducido contra SDK ~54.0.10) — sin ninguna confirmación de que estén resueltos en el SDK 57 que usa este proyecto. El patrón clásico de React Native para adjuntar un archivo local a `FormData` (`formData.append("audio", { uri, name, type })`, un objeto plano, no un `File`/`Blob` real) es justamente la superficie que esos issues señalan como problemática en la implementación nueva. `XMLHttpRequest` es el mecanismo de red que React Native soporta para esto desde mucho antes de que `expo/fetch` existiera, y no está tocado por esos bugs — es una superficie de código totalmente distinta a `response.body.getReader()` (lo que sí usa `expo/fetch` para el streaming, sin relación con este problema). `apps/mobile/lib/voice/uploadAudio.ts` implementa la subida envuelta en una promesa sobre `XMLHttpRequest`.

**Decisión — la síntesis de voz no fuerza una voz específica.** `expo-speech`'s opción `voice` (para pedir una voz por identificador) es conocida por no seleccionar de forma confiable la voz pedida en algunas plataformas (issue #12720 de `expo/expo`, sin confirmación de fix). A diferencia de `apps/web` (que sí elige activamente una voz en español entre las disponibles del navegador, `pickSpanishVoice` en `useSpeechSynthesis.ts`), `apps/mobile`'s `useSpeechSynthesis.ts` solo pasa `language: "es-ES"` y deja que el sistema operativo use su voz por defecto para ese idioma — mismo espíritu de degradación consciente que ya aplicó ADR-014 ("si algo no es confiable, el chat sigue funcionando igual, solo sin esa pieza optimizada").

**Alternativas consideradas.**
- *Usar `expo/fetch` para la subida de audio también, por consistencia con el streaming.* Descartada — la consistencia de usar un solo mecanismo de red no vale el riesgo de una subida de archivo que podría fallar de forma intermitente y difícil de diagnosticar sin un dispositivo real para probar (este entorno de desarrollo no tiene uno).
- *Forzar una voz en español específica en `expo-speech`, replicando `pickSpanishVoice` de web.* Descartada — dado que la opción que lo permitiría (`voice`) es la misma que está señalada como no confiable, agregar ese código no garantiza el resultado y complica el hook sin beneficio verificable.

**Consecuencia.** La subida de audio y el streaming del chat usan dos mecanismos de red distintos dentro de la misma app (`XMLHttpRequest` vs. `expo/fetch`) — una inconsistencia deliberada y documentada, no accidental. Ninguna de las dos decisiones de este ADR pudo verificarse contra un dispositivo real en este entorno de desarrollo (sin simulador disponible) — quedan como la primera prueba real pendiente cuando se corra la app en un dispositivo/simulador de verdad.

### ADR-033: Auth y autorización por usuario en el Gateway (P2, docs/19) — verificación de JWT, pairing del Edge Agent, y dónde vive el chequeo de ownership

**Contexto.** `docs/16` P2 dejaba planteado el problema (el Gateway no tenía ningún concepto de usuario) y una forma general de solución, pero varias decisiones concretas solo se resolvieron al implementar, en 5 incrementos (`docs/19`). Este ADR las deja asentadas.

**Decisión — verificación de JWT con `supabase.auth.getUser()`, no JWKS local.** De las 3 vías documentadas por Supabase (`getUser()` con round-trip de red, verificación local vía JWKS con `jose`, o el secreto HS256 legacy), se eligió `getUser()`: cero dependencia nueva (reutiliza el cliente `service_role` que ya existía para `SupabaseAuditStore`, ADR-026), y funciona sin necesidad de confirmar si el proyecto usa firma HS256 o asimétrica — la opción JWKS solo es viable si el proyecto ya migró a firma asimétrica, algo que no se verificó. El Gateway no es una vía de alto QPS (plano de control de chat/jobs/dispositivos), así que el costo de latencia por request es aceptable. `apps/gateway`'s `userAuthMiddleware.ts` es opcional y no rechaza requests sin `X-User-Token` — solo un token presente pero inválido se rechaza (401).

**Decisión — el pairing del Edge Agent viaja en el `hello`, no reemplaza el secreto de WS.** `apps/desktop` no tiene ni tendrá sesión de Supabase (corre como proceso de fondo, sin usuario presente). Para asociarlo a un `ownerId` se usa un código de un solo uso (10 min de validez, generado desde `/dispositivos` en `apps/web` por un usuario logueado) que el Edge Agent reclama contra `POST /v1/pairing/claim` — ruta deliberadamente sin el token interno del Gateway (`KAN_GATEWAY_INTERNAL_TOKEN`), porque `apps/desktop` nunca lo tiene y meterlo ahí sería el mismo error que este mecanismo busca evitar (secreto de servidor en un cliente distribuido). El claim devuelve un secreto de larga vida (guardado hasheado, `sha256`, nunca en texto plano tras el claim) que viaja de ahí en más como campo opcional `pairingToken` en cada `hello` — el secreto compartido de WS (`KAN_EDGE_TOKEN`) sigue intacto como gate de admisión de la conexión; el pairing es una capa de identidad adicional, no un reemplazo.

**Decisión — un `pairingToken` que no resuelve no rechaza la conexión.** Si el secreto no coincide con ningún pairing activo (revocado, corrupto, o Supabase caído en ese momento), el Edge Agent se conecta igual, sin `ownerId`. Rechazar la conexión tumbaría un dispositivo físico por un problema de identidad que en ese momento todavía no bloquea nada — distinto del caso HTTP (ADR de incremento 1), donde rechazar una sola llamada es de bajo costo.

**Decisión — el chequeo de ownership vive en `Gateway.executeTool()`, no en `TaskOrchestrator.submit()`.** Los jobs programados (`Gateway.bootstrap()`) llaman a `submit()` directo desde el scheduler, sin ninguna request HTTP de por medio — nunca van a tener un `requestingUserId`. Poner el chequeo dentro de `submit()` habría rechazado cualquier automatización sobre un agente ya vinculado, porque los jobs no tienen (ni ganan, en este incremento) un owner propio. `Gateway.executeTool()` es la única puerta real de entrada desde HTTP — cubre tanto una llamada directa a `POST /v1/tools/:name/execute` como el flujo de chat (`GatewayToolProvider`, que ya manda `X-User-Token`) — así que ahí es donde se resuelve el owner del agente y se compara contra `requestingUserId`, antes de delegar al `ToolExecutor`. Un agente sin vincular (`ownerId` indefinido) sigue abierto para cualquiera — mismo criterio en `AgentRegistry.list()`/`GlobalCapabilityRegistry.list()`, que filtran del mismo modo para `GET /v1/agents`/`GET /v1/tools`.

**Decisión — `AuditEntry` gana `userId?: string`, no se sobrecarga `actor`.** `actor` se queda como clasificación de rol (`llm`/`user`/`system`); `userId` es la identidad concreta, poblada con el `requestingUserId` verificado en acciones disparadas por HTTP/chat, o con el `ownerId` del Edge Agent involucrado en las que vienen de un mensaje WS (no hay otra identidad disponible ahí — nadie más tiene sesión propia en `apps/desktop`). `job.notification` se queda sin `userId` a propósito: puede cubrir varios pasos/dispositivos con distinto owner, no hay un único valor correcto.

**Alternativas consideradas.**
- *Verificación JWKS local desde el incremento 1.* Descartada por ahora — depende de un modo de firma no confirmado; documentada como optimización futura si la latencia de `getUser()` llega a medirse como un problema real.
- *Chequeo de ownership dentro de `TaskOrchestrator.submit()`, literal como en la propuesta original de `docs/16`.* Descartada tras confirmar que rompería jobs programados sobre agentes vinculados — requeriría además darle un `ownerId` a `ScheduledJob`, expandiendo el alcance del incremento 4 más allá de lo pedido.
- *Guardar el `userId` dentro de `metadata` en vez de un campo nuevo.* Descartada — un campo de primer nivel es indexable/filtrable (`GET /v1/audit` lo usa directo), `metadata` queda para detalle específico de cada acción.

**Consecuencia.** El chequeo de autorización y el de resolución de `ownerId` viven en capas distintas de las que originalmente proponía `docs/16` (`Gateway.executeTool()`/`WsConnectionManager.onHello()` en vez de `TaskOrchestrator.submit()`/`WsConnectionManager.handleUpgrade()`) — una desviación deliberada de la propuesta inicial, documentada acá porque cambia dónde un futuro cambio de autorización debería tocar. Los jobs programados quedan, a propósito, fuera del alcance de la autorización por owner — es la pieza más visible que falta si se retoma este tema más adelante.

### ADR-034: `VoiceProviderPort` gana `synthesize()` — OpenAI TTS reemplaza SpeechSynthesis nativo como default

**Contexto.** ADR-014 dejó `VoiceProviderPort` con un solo método a propósito, y planteó explícitamente la condición para ampliarlo: *"El puerto gana `synthesize()` el día que se sume un proveedor de TTS de red real (ElevenLabs, Google Cloud TTS), con el mismo patrón que ya funcionó para STT."* La voz nativa del navegador (`SpeechSynthesis`) cumplió su rol en Fase 1 pero suena robótica — no alcanza la sensación de "asistente" que se busca para el chat por voz.

**Decisión.** `VoiceProviderPort` gana `synthesize(text: string): Promise<Blob>`. El adaptador es `OpenAiTtsProvider` (paquete `@kan/voice-abstraction`, mismo rol que `GroqVoiceProvider`): `fetch` directo contra `POST /v1/audio/speech` de OpenAI, sin SDK (mismo criterio que ADR-011), modelo `gpt-4o-mini-tts` y voz `onyx` por defecto. Como `GroqVoiceProvider` (STT) y `OpenAiTtsProvider` (TTS) son proveedores de red distintos y ninguno implementa el puerto completo, `TranscribeAudioUseCase` y el nuevo `SynthesizeSpeechUseCase` dependen cada uno de un `Pick<VoiceProviderPort, ...>` angostado a lo que realmente usan, no del puerto entero — evita forzar un método "no implementado" en cualquiera de los dos adaptadores. `apps/web/lib/voice/useSpeechSynthesis.ts` intenta primero `/api/voice/synthesize` (OpenAI) y cae en silencio al `SpeechSynthesis` nativo si esa llamada falla por cualquier motivo (sin `OPENAI_API_KEY`, red caída, error del proveedor) — mismo espíritu de degradación consciente de ADR-014.

**Decisión — auto-play solo si el turno fue por voz.** A diferencia del `SpeechSynthesis` nativo (gratis, sin límite de uso), OpenAI TTS tiene costo real por request. Leer en voz alta automáticamente cada respuesta del asistente —como hacía Fase 1, sin excepción— generaría costo en cada mensaje tipeado, que es el caso de uso mayoritario. `ConversationPanel.tsx` ahora solo llama `speak()` cuando el mensaje que originó la respuesta vino del micrófono (push-to-talk); un mensaje tipeado no dispara audio. No hay toggle de UI en este incremento — es una regla fija, no una preferencia configurable todavía.

**Por qué.** Igual que en STT (ADR-014), un proveedor de red real da voces sensiblemente mejores que las Web APIs nativas del navegador. La combinación de fallback silencioso + gate por origen del turno preserva las dos garantías que ya tenía Fase 1: el chat nunca se rompe por un problema de voz, y no se generan costos de red donde el usuario no pidió voz.

**Consecuencia.** Cada respuesta hablada por voz ahora tiene un costo real de API (OpenAI TTS), mitigado por el gate de auto-play. `apps/mobile` no se toca — sigue con `expo-speech` nativo (ADR-032); si en el futuro se quiere el mismo TTS de red ahí, es una extensión de este mismo `OpenAiTtsProvider`, no un rediseño.

---

### ADR-035: Memoria activa — `kan_set_memory`/`kan_remove_memory` como tools internas del Core, nunca vía Gateway

**Contexto.** ADR-015 dejó resuelta la mitad de lectura de memoria: `MemoryStorePort`, la tabla `memories`, y `UserScopedMemoryContext` inyectando hechos relevantes en el `systemPrompt` de `SendMessageUseCase`. Faltaba la mitad activa — que KAN pueda guardar/borrar un hecho durante la conversación ("recordá que mi impresora se llama Ender 3") sin que el usuario tenga que ir a `/configuracion` a mano.

**Decisión.** `kan_set_memory` y `kan_remove_memory` se declaran (`ToolDescriptor[]`) y se despachan enteramente dentro de `SendMessageUseCase` (`packages/core/src/application/memoryTools.ts`), usando el mismo `MemoryContextPort` que ya inyecta el contexto de lectura — ahora ampliado con `set()`/`remove()`. Nunca pasan por `ToolProviderPort`/Gateway/Edge Agent: no son acciones físicas (no aplica ADR-004/ADR-010, la capa de confirmación para acciones irreversibles), son lectura/escritura de datos propios del usuario ya autorizados por su sesión — mismo criterio que ya separaba `MemoryContextPort` de `ToolProviderPort` desde que existe. Por eso están siempre disponibles: `SendMessageUseCase` las ofrece en cuanto hay un `memoryContext` inyectado, sin importar si el Gateway está configurado o caído (antes, el bloque de despacho de tools exigía `this.toolProvider`; ahora exige `this.toolProvider || this.memoryContext`).

Las categorías quedan fijas (`MEMORY_CATEGORIES` en `@kan/core`: `dispositivos`, `preferencias`, `proyectos`, `general`) y compartidas entre el `enum` del `inputSchema` de las tools y el `<select>` de `/configuracion` — la misma taxonomía la use el modelo o un humano. `MemoryEntry.category` sigue siendo `string` (no se angosta al enum): es una convención hacia adelante, no una migración de datos existentes.

**Por qué.** Forzar estas tools a pasar por el Gateway (como cualquier capability de hardware) las ataría a la disponibilidad de un servicio que no necesitan y que memoria nunca debería depender de tener corriendo. Reutilizar `MemoryContextPort` en vez de crear un tercer puerto de memoria evita duplicar la abstracción "ya escopeada a este usuario" que `UserScopedMemoryContext` ya resuelve para lectura.

**Consecuencia.** `/configuracion` ya tenía alta/baja manual (el alta ya hacía `upsert` sobre `user_id,category,key`); lo que faltaba era la afordancia de edición — el nuevo `MemoryManager.tsx` la agrega reutilizando `addMemoryAction` tal cual (editar es re-enviar el mismo `category`+`key` con otro `value`), sin caso de uso nuevo. La memoria puede crecer sin límite por ahora — sin poda ni resumen — coherente con "estructurada antes que RAG" de ADR-015; queda como límite conocido, no oculto, a revisar si el volumen real de hechos por usuario lo justifica.

---

### ADR-036: Visión (P3) auditada como ya completa — verificación end-to-end en vivo, no solo lectura de código

**Contexto.** El pedido de este incremento era diagnosticar qué faltaba de Visión (imágenes en el chat) antes de implementar nada. ADR-018 ya había resuelto el diseño (imagen inline en `Message`, base64 en la fila) — la pregunta era si esa infraestructura realmente estaba conectada de punta a punta o si algo quedó a medio terminar, como ya había pasado en incrementos anteriores de este proyecto con código que se veía correcto pero divergía del estado real de la base (migraciones 0001-0008 nunca aplicadas, `messages_role_check` desactualizado respecto del archivo de migración).

**Decisión — verificar con una llamada real, no solo leer el código.** Se mandó un mensaje real a `/api/chat` con una imagen de 1x1 píxel adjunta, contra el servidor corriendo de verdad, y se confirmó: (a) Gemini identificó el color de la imagen en su respuesta (prueba de que `inlineData` realmente llega al modelo, no un passthrough vacío), y (b) se consultó Supabase directo (`select image_data, image_mime_type from messages`) y la fila quedó persistida completa. Con eso confirmado, se leyó el resto de la cadena (`ConversationPanel.tsx`, `GeminiProvider.toGeminiContent()`, `SupabaseConversationRepository`) y las tres preguntas del diagnóstico (¿el botón está conectado?, ¿se muestran las imágenes en el historial?, ¿se persisten `image_data`/`image_mime_type`?) dieron que sí en los tres casos — Visión ya estaba completa desde ADR-018, no era un incremento nuevo.

**Único cambio real de este incremento.** `ConversationPanel.tsx` reconstruye los mensajes nuevos después de cada respuesta desde `finalConversation` (la fuente de verdad del server) pero el `.map()` no copiaba el campo `image` — sin efecto visible hoy porque el mensaje del usuario (el único que puede traer imagen) siempre se agrega antes, de forma optimista, y nunca cae en ese slice; pero sí sería una pérdida de datos silenciosa el día que el chat lea historial real desde el server (ej. "continuar conversación anterior"). Se agregó `image: m.image` a ese mapeo — una línea, sin tocar el resto del flujo de texto ni de voz.

**Por qué.** Confiar solo en que el código "se ve correcto" ya produjo falsos positivos en este proyecto (las migraciones, el constraint de `messages`) — para un diagnóstico real, un round-trip contra el servidor y la base corriendo de verdad vale más que la lectura de código, y debería ser el criterio por defecto cuando un incremento empieza preguntando "¿esto ya funciona o es decorativo?".

**Consecuencia.** Ningún archivo de dominio, puerto o adaptador cambió — `Message.ts`, `/api/chat/route.ts`, `GeminiProvider.ts`, `SupabaseConversationRepository.ts` y la migración `0006` quedan tal cual estaban. Precedente para futuros incrementos: cuando el pedido es "diagnosticá qué falta", el resultado válido puede ser "nada, ya está" — no hay que inventar trabajo para justificar el incremento.

---

## 4. Puntos donde recomiendo recortar el alcance del MVP (sin abandonar la visión)

- **"Plugin Lenguaje de Señas"** y **Drones**: quedan en el roadmap de Fase 2+, no en las primeras 50 tareas. Son plugins válidos pero no prueban el concepto central (lenguaje natural → acción física) mejor que ESP32 o impresión 3D, que son más baratos de tener en un banco de pruebas real.
- **DDD "cuando aporte valor"**: coincido explícitamente. En el MVP, el dominio de "conversación/dispositivo/plugin" es simple; forzar agregados y bounded contexts completos ahora sería sobre-ingeniería. Se aplica DDD ligero (entidades y value objects claros) y se reevalúa a medida que el dominio crece.
- **Marketplace público**: el *modelo de permisos* se construye desde ya (ADR-008), pero la *tienda* (UI de descubrimiento, pagos, revisión de terceros) es Fase 2, no Fase 1.

## 5. Documentos relacionados

- [Arquitectura general](01-arquitectura-general.md)
- [Estructura de carpetas](02-estructura-carpetas.md)
- [Arquitectura del Core](03-arquitectura-core.md)
- [Arquitectura de Plugins](04-arquitectura-plugins.md)
- [Arquitectura de IA](05-arquitectura-ia.md)
- [Arquitectura de Dispositivos](06-arquitectura-dispositivos.md)
- [Arquitectura de Comunicación](07-arquitectura-comunicacion.md)
- [Tecnologías](08-tecnologias.md)
- [Roadmap](09-roadmap.md)
- [Backlog y primeras 50 tareas](10-backlog-y-tareas.md)
- [Riesgos](11-riesgos.md)
- [Arquitectura del Gateway](12-arquitectura-gateway.md)
- [Auditoría v0.1](13-auditoria-v0.1.md)
- [Performance v0.1](14-performance-v0.1.md)
- [Seguridad v0.1](15-seguridad-v0.1.md)
- [Propuestas de arquitectura v0.1](16-arquitectura-propuestas-v0.1.md)
