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
