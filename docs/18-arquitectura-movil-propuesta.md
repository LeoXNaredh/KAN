# Propuesta de Arquitectura — App Móvil (React Native/Expo), roadmap P7

> Mismo criterio que `docs/16`: esto es una **propuesta documentada, no implementada todavía**. Cada punto tiene problema/propuesta/costo/prioridad. Tres de los puntos exponen un gap real de código y se proponen como ADRs numerados (029-031) — no se agregan a `docs/00` hasta confirmarlos, mismo proceso que ya se usó para el pivote de `docs/17`.

## 0. Qué ya está decidido (no se reabre acá)

- **ADR-005** (`docs/00`): React Native + Expo sobre Flutter, por compartir lenguaje/lógica con el Core (TS) y la curva de equipo ya conocida (TS/Next.js/React).
- **ADR-002** (`docs/00`): el monorepo existe justamente para que un futuro cliente móvil comparta `@kan/core` sin duplicar lógica.
- **ADR-017** (`docs/00`): `AuthPort`/`UserProfilePort` viven en `@kan/core`, el adaptador concreto en `@kan/supabase-adapter` recibe un `SupabaseClient` ya construido por inyección — dicho explícitamente pensando en esto: *"lo que permite que un futuro cliente móvil (React Native, roadmap P7) reutilice `@kan/supabase-adapter` sin rediseño — solo cambia quién construye el `SupabaseClient` y quién le inyecta las cookies/tokens"*.
- `docs/17` §0 solo tiene una línea sin desarrollar para P7: *"Apps móviles: Android, iOS, PWA, notificaciones push"*. Todo lo de abajo es terreno nuevo.

## 1. Conectividad — la app móvil nunca habla con el Gateway directo

**Problema.** La pregunta obvia es "¿el cliente móvil habla con el Gateway como hace `apps/web`?". No — y no debería, nunca. `GEMINI_API_KEY` y `KAN_GATEWAY_INTERNAL_TOKEN` viven solo en el proceso servidor de `apps/web` (Route Handlers de Next.js, que corren en un servidor, nunca se bundlean al navegador). Una app móvil es un binario que se distribuye a las tiendas y cualquiera puede decompilar — embeber esas credenciales ahí sería un incidente de seguridad, no un detalle de implementación.

**Propuesta.** Dos caminos, según qué secreto está en juego:
- **A través de la API HTTP de `apps/web`** (`/api/chat`, SSE, y `/api/voice/transcribe`) — todo lo que necesita el proveedor de IA o el Gateway. La app móvil consume estas rutas exactamente como ya lo hace el navegador hoy; confirmado en el código que `/api/chat` **no depende de sesión de Supabase para funcionar** (`buildSendMessageUseCase()` cae a `InMemoryConversationRepository` sin `user`) — el streaming funciona igual sin autenticación, solo sin persistencia/memoria/personalidad. Cero cambios a `route.ts` para este camino.
- **Directo a Supabase** para todo lo demás (auth, perfil, preferencias, memoria, historial de conversaciones) — la app construye su propio `SupabaseClient` y reutiliza sin cambios los adaptadores de `@kan/supabase-adapter` (`SupabaseAuthAdapter`, `SupabaseUserProfileAdapter`, `SupabaseUserPreferencesStore`, `SupabaseMemoryStore`, `SupabaseConversationRepository`), protegido por las mismas políticas RLS que ya protegen a `apps/web`.

**Costo estimado:** bajo — es una decisión de conectividad, no código nuevo (los adaptadores ya existen y son transport-agnostic).

**Prioridad:** crítica — condiciona todo lo demás, incluida la regla de seguridad del §6.

## 2. Sesión — cliente Supabase propio con storage de React Native, no cookies

**Problema.** `apps/web` autentica 100% vía cookies (`@supabase/ssr`, `createServerClient` leyendo `next/headers`). Una app React Native no tiene un cookie jar atado a un dominio de la forma en que lo tiene un navegador.

**Propuesta.** `@supabase/supabase-js`'s `createClient(url, anonKey, { auth: { storage: <adapter>, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } })`. La investigación encontró **dos guías vigentes en paralelo** en la documentación de Supabase/Expo (no es un caso resuelto): `@react-native-async-storage/async-storage` (patrón más establecido, con más recorrido en producción) vs. `expo-sqlite/localStorage` (guía específica de Expo, más nueva). Recomendación: empezar con **AsyncStorage** por ser el patrón con más historial documentado; revisitar si Supabase termina de consolidar la guía de `expo-sqlite` como la única recomendada. Ningún cambio a `@kan/supabase-adapter` en cualquiera de los dos casos — el adaptador solo recibe el cliente ya construido, como siempre.

**Costo estimado:** bajo (configuración, no lógica nueva).

**Prioridad:** crítica — es el prerrequisito de todo lo del §1 que va directo a Supabase.

### ADR-029 (propuesto): `/api/chat` acepta `Authorization: Bearer <token>` además de cookies

**Contexto.** Confirmado en el código: `buildSendMessageUseCase()` (`apps/web/lib/chat/composition.ts`) solo reconoce sesión vía `getCurrentUserCached()`, que a su vez depende enteramente de `@supabase/ssr` y cookies. Un cliente móvil autenticado (sesión de Supabase vía AsyncStorage, §2) no tiene cookies que mandar — hoy pegaría contra `/api/chat` y siempre caería al fallback sin sesión (conversación en memoria, sin persistencia ni memoria ni personalidad), aunque el usuario esté logueado en la app.

**Decisión propuesta.** Extender la resolución de usuario en `apps/web` para que, si la request trae `Authorization: Bearer <access_token>`, se valide ese JWT contra Supabase (`supabase.auth.getUser(token)`, con el cliente `anon key` — mismo criterio de ADR-017 de no requerir `service_role`) y se use ese usuario en vez de intentar leer cookies. El camino de cookies (web) sigue exactamente igual — es una rama adicional, no un reemplazo.

**Alternativas consideradas.**
- *Que la app móvil arme sus propias cookies falsas para simular un browser.* Descartada — fragile y no es el mecanismo real de sesión de un cliente no-browser.
- *Que la app móvil no tenga persistencia de conversación del lado servidor y guarde todo localmente.* Descartada como default — rompería la paridad de "seguir la misma conversación desde cualquier dispositivo" que ya tiene la sesión de usuario en web.

**Costo estimado:** bajo — cambio aislado a `apps/web/lib/chat/composition.ts` y al punto donde se resuelve el usuario actual; no toca `@kan/core` ni `@kan/supabase-adapter`.

**Prioridad:** alta — sin esto, la app móvil funciona pero como si el usuario nunca hubiera iniciado sesión en el chat.

## 3. Streaming — `expo/fetch` en vez del `fetch` global, parser SSE compartido

**Problema.** El `fetch` nativo de React Native (sobre el motor Hermes) todavía no implementa `ReadableStream` de forma completa — `response.body.getReader()` falla, cuelga, o nunca entrega chunks, según la versión. Es un problema conocido desde 2020 ([facebook/react-native#27741](https://github.com/facebook/react-native/issues/27741)) que **sigue sin resolverse en 2026**. Esto es directamente relevante porque `/api/chat` ya es streaming (SSE, construido en el incremento anterior de esta misma sesión) — sin resolver esto, el streaming simplemente no funcionaría en el cliente móvil.

**Propuesta.** Usar `import { fetch } from "expo/fetch"` (no el `fetch` global) para las llamadas a `/api/chat` — es el fetch propio de Expo, compatible con WinterCG, disponible desde el SDK 52 (el estable actual es el SDK 57), que sí expone un `response.body.getReader()` funcional, incluido para `text/event-stream`. Además, `apps/web/lib/chat/parseSseStream.ts` ya tiene una mitad 100% portable: `parseSseChunk(buffer)` es una función pura, sin ninguna dependencia de DOM o del navegador. Se propone **extraerla a `@kan/core`** (o un paquete chico nuevo) para que web y mobile consuman exactamente el mismo parser ya probado, en vez de reimplementarlo dos veces. Solo `readSseStream` (la parte que llama `response.body.getReader()`) necesita una versión mobile-specific — misma firma, recibiendo el `Response` de `expo/fetch` en vez del `Response` del navegador.

**Riesgo documentado, no resuelto acá:** hay reportes (issues de `expo/expo`, ej. #37310) de `expo/fetch` agrupando chunks en un solo bloque en vez de entregarlos incrementalmente en ciertas versiones de SDK — no bloqueante, pero amerita una prueba manual temprana contra la versión exacta de SDK elegida, antes de construir mucha UI encima asumiendo que el streaming granular funciona.

### ADR-030 (propuesto): extraer `parseSseChunk` de `apps/web` a `@kan/core`

**Contexto.** Ver arriba — `parseSseChunk` no tiene ninguna dependencia de plataforma, `readSseStream` sí (llama `response.body.getReader()` sobre un `Response` concreto).

**Decisión propuesta.** Mover `parseSseChunk` (no `readSseStream`) a `@kan/core` (candidato natural: mismo paquete que ya define `ChatStreamEvent`, el tipo que estos chunks transportan). `apps/web` y `apps/mobile` importan la función compartida y cada uno mantiene su propia versión chica de `readSseStream` (la parte atada a su runtime de `fetch`).

**Alternativas consideradas.**
- *Duplicar el parser en `apps/mobile`.* Descartada — es exactamente el tipo de lógica que el monorepo existe para compartir (ADR-002), y ya está escrita y implícitamente probada en producción vía el uso real en `apps/web`.

**Costo estimado:** bajo (mover una función pura de ~20 líneas).

**Prioridad:** media — no bloqueante para arrancar, pero barato de hacer bien desde el principio en vez de duplicar y después tener que unificar.

## 4. UI — NativeWind + componentes propios chicos, no un framework de componentes completo

**Problema.** `apps/web` tiene un design system chico pero real (`DESIGN_SYSTEM.md`): 12 colores con nombre semántico (`accent`, `surface-3`, `ink-faint`, etc.), 3 niveles de radio, una escala tipográfica de 4 roles, 3 duraciones de transición, iconos de `lucide-react`. La pregunta es qué tan cerca puede quedar la app móvil de esa misma identidad visual sin construir un segundo sistema de diseño desde cero.

**Propuesta.** **NativeWind** — de las tres opciones evaluadas, es la que más se acerca a "las mismas clases utilitarias y los mismos tokens":

| Opción | Por qué sí/no |
|---|---|
| **NativeWind** (recomendada) | Clases Tailwind directo sobre componentes RN. Mismo lenguaje que ya usa todo `apps/web`. |
| Tamagui | Mejor rendimiento cross-platform y hasta genera output web real, pero tiene su propio compilador/config y sus tokens están "alineados" con Tailwind, no son los mismos — más curva de configuración de la que el tamaño de este design system justifica. |
| React Native Paper | Sistema de theming Material Design 3 propio, sin relación con clases utilitarias — habría que traducir cada token a un shape de theme completamente distinto. |

**Matiz importante encontrado en la investigación:** `apps/web` ya migró a Tailwind v4 (config CSS-first, `@theme` dentro de `globals.css`, sin `tailwind.config.js`). **NativeWind v4 — la versión estable, production-ready — todavía espera el formato v3** (`tailwind.config.js` en JS). NativeWind v5 alinea con el formato CSS-first de v4, pero está en preview, no es el default, y tiene cambios incompatibles con v4. Recomendación pragmática: un `tailwind.config.js` en `apps/mobile` con los mismos valores que ya están en `DESIGN_SYSTEM.md`/`globals.css` — sí, es duplicar un objeto de configuración chico, pero es una duplicación consciente y acotada, no una arquitectura nueva. Mismo criterio que el proyecto ya aplica: `apps/desktop` tampoco comparte hoy los tokens de `apps/web`, por decisión explícita documentada en `DESIGN_SYSTEM.md` §"Alcance". Se revisita esta duplicación el día que NativeWind v5 sea el default.

Componentes: replicar los mismos 3-4 componentes chicos que ya existen en `apps/web/components/ui/` (`Card`, `Badge`, `StatusDot`) como sus equivalentes RN — no adoptar una librería de componentes completa (gluestack-ui, React Native Paper) que traería su propio sistema de theming superpuesto al de NativeWind.

**Costo estimado:** bajo-medio (configuración de NativeWind + portar ~4 componentes chicos).

**Prioridad:** media-alta — no bloquea la funcionalidad, pero es la diferencia entre "se siente KAN" y "se siente una app RN genérica".

### ADR-031 (propuesto): tokens de diseño duplicados a propósito entre `apps/web` y `apps/mobile`, no un paquete compartido todavía

**Contexto.** Ver el matiz de arriba — no existe hoy una forma de que un `@theme` CSS-first (Tailwind v4, web) y un `tailwind.config.js` (NativeWind v4, mobile) lean de una única fuente sin herramienta adicional.

**Decisión propuesta.** Aceptar la duplicación consciente de los valores (documentados una sola vez en `DESIGN_SYSTEM.md`, copiados a mano al `tailwind.config.js` de `apps/mobile`) en vez de construir un paquete `packages/design-tokens` con generación de ambos formatos — sería sobre-ingeniería para 12 colores y 3 radios, y ya hay precedente de esta misma decisión con `apps/desktop`.

**Alternativas consideradas.**
- *Paquete `packages/design-tokens` (JSON/TS) que genera tanto el CSS `@theme` como el `tailwind.config.js`.* Descartada por ahora — se revisita si el número de tokens crece significativamente o si aparece un tercer consumidor (ej. si NativeWind v5 lo simplifica solo).

**Costo estimado:** ninguno (es la decisión de no construir algo).

**Prioridad:** baja — documentar la decisión, no una tarea.

## 5. Voz e imagen — mismo contrato de API, nuevas dependencias nativas de captura

**Problema.** `useVoiceInput.ts` y `useSpeechSynthesis.ts` (`apps/web/lib/voice/`) usan APIs 100% de navegador (`MediaRecorder`, `window.speechSynthesis`) sin ninguna capa compartida — confirmado, cero abstracción cross-platform existente hoy para esto. Lo mismo la captura de imagen en `ConversationPanel.tsx` (`<input type="file">` + `FileReader`).

**Propuesta — no hace falta tocar el backend, solo el lado nativo de captura:**
- **STT:** se sigue usando `/api/voice/transcribe` (Groq, ya server-side y agnóstico de plataforma, ADR-014) — la app móvil solo graba localmente y sube el audio grabado, mismo contrato HTTP que ya usa `useVoiceInput.ts`. Grabación con **`expo-audio`** — `expo-av` fue removido en el SDK 55, no es una opción viable para un proyecto que arranca hoy en SDK 57.
- **TTS:** **`expo-speech`** (motores nativos del OS, gratis) — mismo criterio que ADR-014 ya usó en web (preferir la síntesis nativa de la plataforma antes que sumar un proveedor de red).
- **Imagen:** **`expo-image-picker`** (cámara + galería) produciendo el mismo shape `{ data: base64, mimeType }` que `Message.image` ya define (ADR-018) — cero cambios de backend, el límite de 4MB ya validado server-side sigue aplicando igual.

**Costo estimado:** medio — son 3 flujos de UI nativos nuevos, aunque cada uno hable con un contrato de backend que ya existe y no cambia.

**Prioridad:** media — se puede secuenciar después de que el chat de texto funcione end-to-end (ver §7).

## 6. Regla de seguridad explícita para `apps/mobile`

**Nunca**, bajo ninguna circunstancia, `apps/mobile` importa `@kan/ai-abstraction` (contiene la integración directa con Gemini) ni construye algo que conozca `KAN_GATEWAY_INTERNAL_TOKEN`/`KAN_EDGE_TOKEN`. Estas credenciales existen solo porque hoy corren en un proceso servidor que nunca se distribuye — una app móvil es, por definición, un artefacto distribuido. Esto no es una omisión a resolver más adelante, es una restricción de diseño permanente, tan seria como la regla de ADR-010 (la confirmación de acciones peligrosas nunca se delega al chat remoto).

## 7. Estructura del monorepo y orden de incrementos sugerido

`apps/mobile` (Expo, SDK 57) — se registra solo con crear la carpeta, `pnpm-workspace.yaml` ya incluye `apps/*`. Dependencias: `@kan/core` (tipos de dominio y el parser SSE del §3), `@kan/supabase-adapter`, `@supabase/supabase-js`. Nunca `@kan/ai-abstraction` ni nada relacionado al Gateway (§6).

Orden propuesto si se aprueba esta propuesta (cada incremento se confirma antes de empezarlo, mismo proceso de siempre):

1. Scaffold de `apps/mobile` (Expo + NativeWind configurado con los tokens del §4) + auth (§2) contra Supabase real.
2. Chat de solo texto contra `/api/chat` con streaming (§1, §3) — sin voz ni imagen todavía, para validar `expo/fetch` contra hardware/SDK real antes de construir más encima.
3. ADR-029 (§2) implementado, para que el chat de la app móvil tenga persistencia/memoria real, no el fallback en memoria.
4. Voz (§5) — STT + TTS.
5. Imagen (§5).
6. Paridad de Dashboard (`/api/status`) y Automatizaciones — fuera del alcance de esta propuesta, a detallar cuando se llegue.

## 8. Documentos relacionados

- [00 — Análisis y Decisiones (ADRs)](00-analisis-y-decisiones.md) — ADR-002, ADR-005, ADR-017.
- [16 — Propuestas de Arquitectura v0.1](16-arquitectura-propuestas-v0.1.md) — mismo formato de propuesta usado acá.
- [17 — Plan de implementación v0.2](17-plan-implementacion-v0.2.md) — P7 en el roadmap de producto.
- `DESIGN_SYSTEM.md` (raíz del repo) — tokens de diseño de `apps/web`, fuente de los valores del §4.
