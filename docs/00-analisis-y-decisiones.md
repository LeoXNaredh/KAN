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
