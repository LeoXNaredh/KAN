# Propuesta de Arquitectura — Auth y autorización por usuario en el Gateway, roadmap P2

> **Estado (2026-08-07): incremento 1 de 4 completo.** El Gateway (`apps/gateway`) ya puede verificar un JWT de Supabase si llega en el header `X-User-Token`, reutilizando `AuthPort.getCurrentUser()` (`@kan/supabase-adapter`, mismo mecanismo de ADR-029) sobre el cliente `service_role` que ya existía (ADR-026) — sin credenciales nuevas. Sin ese header, todo funciona exactamente igual que antes (retrocompatible, tests existentes sin cambios). Todavía sin autorización real ni pairing del Edge Agent — eso son los incrementos 2-4. `apps/web`/`apps/mobile` todavía no mandan el token; queda para el próximo incremento.

## 0. Qué ya está decidido (no se reabre acá)

- **ADR-017** (`docs/00`): `AuthPort`/`UserProfilePort` en `@kan/core`, Supabase como único adaptador (`@kan/supabase-adapter`), sin necesidad de `service_role` en ese momento.
- **ADR-026** (`docs/00`): el Gateway ya tiene un cliente de Supabase con `service_role` key (`apps/gateway/src/server.ts`), construido para `SupabaseAuditStore`. Este documento lo reutiliza en vez de introducir una credencial nueva.
- **`docs/16` P2** (histórico): ya identificaba el problema y la forma general de la solución ("el Gateway valida el JWT y lo asocia a cada `AgentRecord`... `TaskOrchestrator.submit()` rechaza si el agente no pertenece al usuario"), con costo estimado "alto (varios días)". Este documento reemplaza esa sección con el análisis detallado y la decisión concreta.

## 1. Problema

El Gateway no tiene ningún concepto de usuario. Todo — WebSocket de Edge Agents, rutas HTTP, jobs programados, auditoría — está protegido por un único secreto compartido (`KAN_EDGE_TOKEN` para WS, `KAN_GATEWAY_INTERNAL_TOKEN` para HTTP). Cualquier proceso con ese secreto puede invocar cualquier dispositivo de cualquier Edge Agent conectado. Costo ya documentado: ADR-021 dejó `notification.userId = "system"` como limitación conocida "porque el Gateway no tiene noción de usuario/sesión"; es prerequisito duro para notificaciones push reales y para el marketplace de plugins (ADR-008 exige modelo de permisos por usuario).

## 2. Análisis de la arquitectura actual

**Dos superficies de entrada al Gateway, con problemas distintos:**

1. **HTTP, desde `apps/web`/`apps/mobile`** (`apps/gateway/src/http/routes.ts`): `GET /v1/tools`, `POST /v1/tools/:name/execute`, `GET /v1/agents`, `GET /v1/audit`, `GET/POST/DELETE /v1/jobs*`. Todas detrás de un middleware que compara `KAN_GATEWAY_INTERNAL_TOKEN` con `safeCompareToken`. Cero scoping por usuario. Las rutas de `apps/web`/`apps/mobile` que llaman a estas (`/api/jobs`, `/api/tools`, `/api/status`) tampoco piden sesión hoy — son proxies finos sin autenticación de usuario en ningún punto de la cadena (confirmado al construir el incremento 6 de `docs/18`).

2. **WebSocket, desde `apps/desktop` (Edge Agent host)** (`packages/gateway-core/src/infra/WsConnectionManager.ts`): `handleUpgrade()` valida el mismo tipo de secreto compartido *antes* de que exista ninguna identidad por agente. `onHello()` crea el `AgentRecord`/`AgentConnectionInfo` solo con `edgeAgentId` — ni `HelloMessage` (`packages/plugin-contract/src/protocol.ts`) ni `AgentRecord` (`packages/gateway-core/src/domain/entities/AgentRecord.ts`) tienen campo de owner. `AgentRegistry` indexa únicamente por `edgeAgentId`, sin índice secundario por usuario.

**El punto de la lógica de negocio sin chequeo de propiedad**: `TaskOrchestrator.submit()` (`packages/gateway-core/src/application/TaskOrchestrator.ts`) resuelve `capabilityRef` → agente propietario → despacha, sin ningún paso intermedio que verifique "¿este llamador puede usar este agente?". `GlobalCapabilityRegistry` tampoco lleva owner. `AuditEntry.actor` (`packages/gateway-core/src/domain/entities/AuditEntry.ts`) es una unión cerrada de 3 valores (`"llm" | "user" | "system"`) sin lugar para un id de usuario específico.

**El hallazgo más importante — `apps/desktop` no tiene ningún concepto de usuario**: no depende de `@supabase/*`, no hay "supabase"/"auth"/"login"/"session" en ningún archivo bajo `apps/desktop/src`. `edgeAgentId` es un `randomUUID()` generado una vez y persistido en un `config.json` local (`apps/desktop/src/main/index.ts`); `KAN_CORE_TOKEN` es el mismo secreto compartido de siempre, pasado tal cual como `Authorization: Bearer` al conectar (`packages/edge-agent-core/src/infra/CoreWebSocketClient.ts`). **No hay ningún JWT que verificar en esta superficie** — el Edge Agent corre como proceso de fondo sin usuario presente, nunca tiene una sesión de Supabase. Esto significa que el problema no es solo "elegir cómo validar un JWT": son dos problemas distintos.

**Un activo ya reutilizable**: el cliente de `service_role` de ADR-026 puede extenderse para verificar JWT sin credenciales nuevas.

## 3. El problema real tiene dos partes independientes

1. **Validación de sesión humana** (`apps/web`/`apps/mobile` → Gateway): el usuario ya tiene un JWT de Supabase (de su sesión de login). El Gateway necesita verificarlo por request y extraer el `user_id` (`sub`).
2. **Emparejamiento del Edge Agent** (`apps/desktop` → Gateway): no hay JWT que verificar nunca en esta vía. Hace falta un mecanismo de *pairing* — un paso único, hecho por un usuario autenticado en `apps/web`, que le diga al Gateway "este `edgeAgentId` pertenece a este `user_id`" y le entregue al Edge Agent una credencial de larga vida para presentarse de ahí en adelante.

La parte 2 es un prerequisito igual de duro que la parte 1: sin ella, `AgentRecord.ownerId` nunca podría poblarse — validar JWT por sí solo diría *quién llama*, no *qué agentes puede usar*.

## 4. Alternativas de validación de JWT de Supabase (parte 1)

Investigación (2026) sobre las 3 vías documentadas por Supabase:

**A. `supabase.auth.getUser(jwt)` — round-trip de red.** Llama a `GET /auth/v1/user` en el servidor de Auth de Supabase en cada verificación. Siempre funciona, sin importar si el proyecto usa firma HS256 (legacy) o asimétrica (ES256/RS256, disponible desde jul-2025). Cero dependencias nuevas — el cliente `service_role` de ADR-026 puede usarse tal cual. Costo: latencia de red en cada llamada autenticada al Gateway.

**B. Verificación local vía JWKS (asimétrica) con `jose`.** `createRemoteJWKSet` + `jwtVerify` contra `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`. Es el patrón que la propia documentación de Supabase recomienda ahora para backends de terceros no-Next.js. Verificación 100% local tras el primer fetch (cacheado en memoria, refetch cada 10 min o al ver un `kid` desconocido, con cooldown de 30s). **Requiere que este proyecto de Supabase ya haya migrado a firma asimétrica** — si sigue en HS256 legacy, el endpoint JWKS no devuelve ninguna clave, y la propia Supabase recomienda para ese caso usar la opción A, no verificación local con el secreto legacy. No se verificó en qué modo está configurado este proyecto — incógnita a resolver antes de poder elegir esta vía con seguridad.

**C. Secreto compartido HS256 legacy.** Verificación local con `JWT_SECRET`. Documentación de Supabase la desaconseja activamente ("casi ningún beneficio frente a firma compartida... riesgo de impersonación, imposible detectar compromiso"). Descartada.

**Sobre revocación** (aplica igual a las 3 vías): un access token de Supabase es un JWT sin estado — `signOut()` revoca el refresh token pero el access token ya emitido sigue siendo válido hasta su `exp` natural (default 1h), sin importar el método de verificación. Ninguna de las 3 opciones resuelve esto por sí sola; si se quisiera revocación inmediata habría que cruzar el claim `session_id` contra `auth.sessions`, un paso extra y opcional, no un diferenciador entre A/B/C.

## 5. Recomendación

**Parte 1 (JWT): opción A (`getUser()`).** Cero dependencia nueva, funciona sin necesidad de confirmar en qué modo de firma está el proyecto (elimina una incógnita bloqueante), y el Gateway no es una vía de alto QPS (plano de control de chat/jobs/dispositivos, no una API de por-tecla). La opción B (`jose` + JWKS) queda documentada como optimización futura *si* la latencia de red por request llega a medirse como un problema real — mismo criterio de "degradación consciente, no prematura" ya usado en ADR-014/ADR-032.

**Parte 2 (pairing): diseño mínimo viable.**
1. Nueva tabla en Supabase, `edge_agent_pairings`: `pairing_code`, `owner_id`, `edge_agent_id` (null hasta reclamarse), `expires_at`.
2. `apps/web`, ya con sesión, expone una acción "Vincular Edge Agent" que genera un código corto de un solo uso (10 min de validez) asociado a `owner_id`.
3. `apps/desktop`, en el primer arranque, pide ese código al usuario (tipeado — sin QR/deep-link para la v1) y lo manda a un endpoint nuevo del Gateway (`POST /v1/pairing/claim`) junto a su `edgeAgentId` local. El Gateway valida el código contra la tabla (vía el cliente `service_role` existente), lo marca reclamado, y devuelve una credencial de emparejamiento de larga vida (aleatoria, guardada con hash) que `apps/desktop` persiste localmente en lugar del `KAN_CORE_TOKEN` global de hoy.
4. De ahí en adelante, `WsConnectionManager.handleUpgrade()` resuelve esa credencial a un `ownerId` (consultando la tabla o una caché en memoria poblada al arrancar) y lo adjunta a `AgentRecord`/`AgentConnectionInfo`.
5. `TaskOrchestrator.submit()` gana un `requestingUserId`; antes de despachar, rechaza si `agent.ownerId !== requestingUserId`. El `userId` verificado en la parte 1 tiene que viajar hasta ahí (rutas HTTP del Gateway y el flujo de chat que usa `GatewayToolProvider`).

Este diseño reemplaza el secreto único por credenciales *por agente*, sin tocar el resto del protocolo WS.

## 6. Plan incremental (para implementación, cada uno con su propio `/plan`)

1. **JWT en el Gateway (parte 1 sola).** Middleware de verificación con `getUser()` en las rutas HTTP; extrae `userId`, lo deja disponible en el request context. Sin cambios de autorización todavía — solo identidad. `apps/web`/`apps/mobile` empiezan a mandar el `access_token` en `Authorization` hacia sus propias rutas proxy, que lo reenvían al Gateway.
2. **Pairing (parte 2).** Tabla nueva, endpoint `/v1/pairing/claim`, pantalla de vinculación en `apps/web`, `apps/desktop` guarda y usa la credencial nueva. `AgentRecord` gana `ownerId`.
3. **Autorización real.** `TaskOrchestrator.submit()` valida `ownerId`; se propaga `userId` desde las rutas HTTP y desde el flujo de chat hasta ahí; `AgentRegistry`/`GlobalCapabilityRegistry` filtran por owner donde aplique.
4. **Auditoría por usuario.** `AuditEntry.actor` o su `metadata` gana el `userId` real en lugar de los 3 valores genéricos actuales.

## 7. Riesgos / incógnitas abiertas

- No se confirmó en qué modo de firma (HS256 legacy vs. asimétrico) está configurado este proyecto de Supabase — no cambia la recomendación (A funciona en ambos casos) pero sí importa si más adelante se reconsidera la opción B.
- El pairing por código tipeado es la vía más simple para una v1; no cubre multi-dispositivo por agente ni revocación de pairing (habría que agregar un botón "desvincular" en `apps/web`, no diseñado en detalle acá).

## 8. Verificación (por incremento, cuando se implemente)

`pnpm --filter gateway typecheck/lint`, `pnpm -r typecheck/lint/test` del monorepo completo, y prueba manual con `apps/web`/`apps/desktop` corriendo localmente (login real, conexión real de Edge Agent, verificar que un segundo usuario no puede listar ni invocar los agentes del primero).
