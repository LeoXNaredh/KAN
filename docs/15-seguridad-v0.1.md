# Auditoría de Seguridad Formal — Milestone v0.1

> Contexto de evaluación: software de desarrollo pre-v0.1, corriendo en `localhost`, un solo usuario, sin TLS, sin exposición a internet. La severidad de cada hallazgo se evalúa contra ESE contexto — no como si fuera un servicio público en producción. Reevaluar por completo antes de cualquier despliegue compartido o expuesto fuera de una LAN de confianza.

## 1. Autenticación

**Mecanismo actual:** token compartido (`Authorization: Bearer <token>`) en dos puntos:
- Edge Agent → Gateway (`KAN_EDGE_TOKEN`, verificado en el handshake WebSocket, `WsConnectionManager.handleUpgrade`).
- apps/web → Gateway (`KAN_GATEWAY_INTERNAL_TOKEN`, verificado por middleware en cada request HTTP, `apps/gateway/src/http/routes.ts`).

**Estado:**
- ✅ Comparación de tokens en tiempo constante (`safeCompareToken`, `packages/plugin-contract/src/auth.ts`, `crypto.timingSafeEqual`) — corregido en Fase 3 (era `!==` simple).
- ✅ Probado con clientes WS reales (`WsConnectionManager.test.ts`): token inválido rechazado con 401 antes del upgrade.
- ⚠️ **No hay autenticación de usuario final** en `apps/web` — ver sección 2 (Autorización), es el mismo gap.
- ⚠️ Los tokens por defecto en código (`dev-token`, `dev-internal-token`) coinciden con los de `.env.example` — aceptable como default de desarrollo, pero nada impide que un despliegue descuidado los deje así. No implementado: rechazo/warning fuerte si `NODE_ENV=production` y el token sigue siendo el de ejemplo (queda como recomendación, no bloqueante para v0.1 local).

## 2. Autorización

**Dos ejes distintos, solo uno implementado:**
- ✅ **Por severidad de acción** (ADR-004): `read-only`/`reversible` se auto-aprueban, `irreversible-material`/`safety-critical` requieren confirmación explícita en el Edge Agent. Probado exhaustivamente (`PermissionManager.test.ts`, `CapabilityRegistry.test.ts`).
- ❌ **Por usuario**: no existe. Cualquiera que llegue a `/api/chat` (o directo al Gateway con el token interno) puede invocar cualquier capability de cualquier Edge Agent conectado. No hay concepto de "qué usuario puede controlar qué dispositivo".

**Veredicto:** aceptable para v0.1 (un solo usuario, uso local). **Bloqueante** antes de: (a) exponer `apps/web` fuera de `localhost`, (b) soportar más de un usuario/workspace, (c) abrir el Gateway a llamadores de terceros (marketplace, Fase 2+). Requiere Supabase Auth (ya en el roadmap, `docs/09-roadmap.md`) — no es un fix de una línea, es trabajo de la próxima fase de funcionalidad, correctamente fuera de alcance de un milestone de estabilización.

## 3. Validación de entradas

- ✅ **Plugins**: `DeviceSimulatorPlugin` ahora valida tipo real de cada input (`toggle_led` rechaza no-boolean, `move_axis` rechaza no-numérico/NaN/Infinity) — corregido en Fase 3, cubierto por 5 tests dedicados.
- ✅ **Mensajes WebSocket**: se valida que el JSON parseado tenga forma de objeto con `type: string` antes de procesarlo; formas inesperadas se ignoran sin tumbar la conexión — corregido en Fase 3 (`WsConnectionManager.onSocketMessage`), probado con un cliente WS real.
- ⚠️ **`inputSchema` como JSON Schema real**: sigue sin validarse formalmente contra el schema declarado por cada capability — cada plugin valida su propio input a mano (como hace ahora el simulador). Documentado como deuda desde el incremento del Edge Agent; la auditoría confirma que esto deja de ser aceptable en cuanto exista el primer plugin de hardware real (ver `docs/13` M1) — **recomendado bloquear el plugin ESP32/CNC hasta implementar validación real**, no seguir difiriéndolo indefinidamente.
- ✅ **Rutas HTTP del Gateway**: `req.params.name` y `req.body?.args` se usan de forma segura (Express ya sanea `params`; `args` se pasa tal cual al `ToolExecutor`, que a su vez pasa por `ToolResolver` — un nombre de tool inexistente se rechaza antes de tocar nada real).

## 4. Serialización

- Toda la comunicación usa `JSON.stringify`/`JSON.parse` estándar — sin `eval`, sin deserialización insegura de código.
- ⚠️ Sin límite explícito de profundidad/tamaño en objetos JSON individuales más allá del límite de payload WS (ver sección 5) y el límite por defecto de `express.json()`. No se identificó como riesgo práctico a esta escala, pero queda como hardening pendiente si el Gateway se expone más ampliamente.

## 5. WebSockets

- ✅ **Límite de tamaño de mensaje** (`maxPayload: 64KB`) — corregido en Fase 3 (antes sin límite, hasta 100MB por defecto de la librería `ws`). Hallazgo H2 de `docs/13`.
- ✅ **Autenticación en el handshake** antes de aceptar el upgrade.
- ✅ **Versión de protocolo** verificada en el `hello`; una versión mayor incompatible cierra la conexión (código 4001) — probado con un cliente real.
- ✅ **Protección contra `hello` duplicado** en la misma conexión (código 4003) y contra colisión de `edgeAgentId` entre dos conexiones distintas (la vieja se cierra explícitamente con código 4004 en vez de quedar zombie) — corregido en Fase 3, hallazgo A4, probado con clientes WS reales concurrentes.
- ✅ **Heartbeat + reaper**: conexiones sin actividad por 45s se cierran; el cliente manda heartbeat cada 15s con jitter en el reintento (evita reconexiones sincronizadas en oleada tras una caída del Gateway).
- ⚠️ **Sin verificación de `Origin`**: mitigado en la práctica porque la API `WebSocket` del navegador no permite fijar el header `Authorization` en el handshake, así que una página web maliciosa no puede pasar el check de token de todos modos — pero es una mitigación "accidental", no una defensa explícita. No es una prioridad mientras el Edge Agent (el único cliente real) no corra en un navegador.
- ⚠️ **Sin rate limiting** de conexiones ni de mensajes por conexión. Aceptable para un solo Edge Agent local; **debe** resolverse antes de que el Gateway acepte conexiones de terceros no confiables.

## 6. Tokens

- No viajan en texto plano por ningún canal que no sea ya de por sí texto plano (WS/HTTP sin TLS — limitación conocida y aceptada de un entorno 100% local, documentada como tal, no oculta).
- No se encontró ningún punto donde un token se loguee (ni en `FileAndConsoleLogger`, ni en `JsonlAuditStore`, ni en la consola del Gateway).
- Comparación en tiempo constante (ver sección 1).

## 7. Logs

- `FileAndConsoleLogger` (Edge Agent) y la salida de consola del Gateway registran contenido operacional (capability invocada, resultado, errores) — no se detectó fuga de secretos.
- ⚠️ Sin rotación: el archivo de log del Edge Agent crece sin límite. Aceptable para v0.1 (uso de desarrollo, reinicios frecuentes); documentado como deuda antes de un uso prolongado sin reinicios.
- ⚠️ El contenido de mensajes de usuario y `metadata`/`args` completos se registran tal cual, sin redacción. Si en el futuro el input de usuario incluye datos sensibles (ubicación, nombres reales), quedarían en texto plano indefinidamente. No es explotable hoy, es higiene a futuro.

## 8. Auditoría

- ✅ `AuditService` registra toda ejecución de tool disparada desde el Function Calling Engine (LLM → Gateway → Edge Agent), con actor, acción, sujeto y metadata — persistido de forma durable (`JsonlAuditStore`, ahora con escritura asíncrona, Fase 3) y consultable vía `GET /v1/audit`.
- ❌ **Gap conocido**: las invocaciones manuales hechas directo desde la UI del Edge Agent (botones "Invocar" en `apps/desktop`) quedan en el log local del Edge Agent pero **no** llegan al `audit.jsonl` del Gateway — el requisito "toda acción deberá registrarse" (docs/12 §6) hoy solo se cumple para el camino que pasa por el Gateway. No se corrigió en este milestone (requeriría que el Edge Agent reporte también las invocaciones manuales al Gateway cuando esté conectado, con manejo explícito del caso offline) — documentado como deuda priorizada para el próximo incremento de funcionalidad, no como bloqueante de v0.1 dado que el propio dispositivo ya deja rastro local.

## 9. Ataques considerados

| Escenario | Mitigación actual | Suficiente para v0.1 |
|---|---|---|
| Token robado/adivinado desde la misma máquina | Comparación constant-time; token no en logs | Sí (radio de exposición ya es "quien tiene acceso a la máquina") |
| Flood de conexiones WS / mensajes gigantes (DoS) | `maxPayload` 64KB; heartbeat + reaper cierra conexiones muertas | Parcial — falta rate limiting explícito, aceptable a escala de un solo agente |
| LLM alucina un nombre de tool y lo "ejecuta" | `ToolResolver` rechaza cualquier nombre no presente en el `ToolRegistry` real, antes de tocar `TaskOrchestrator` | Sí — este es exactamente el diseño de docs/12 §5 |
| LLM propone argumentos maliciosos/absurdos para una tool real | Validación de input en el plugin (Fase 3); severidad alta sigue requiriendo confirmación humana explícita (ADR-004) | Sí para el simulador; **bloqueante revisar** cuando el input controle hardware físico real con consecuencias mayores que "un número en memoria" |
| Prompt injection vía resultado de una tool que vuelve al LLM | Sin superficie real hoy (el simulador solo devuelve números); ADR-004 ya obliga confirmación humana para acciones peligrosas independientemente de qué diga el LLM | Sí por ahora — revisar en cuanto exista un plugin de visión/OCR que reinyecte texto del mundo físico como contexto |
| Acceso no autorizado entre usuarios/workspaces | **No mitigado** — no existe el concepto de usuario todavía | No aplica a v0.1 (un solo usuario); bloqueante antes de multi-usuario |

## 10. Resumen ejecutivo

**Nada de lo encontrado bloquea el uso de v0.1 en desarrollo local de un solo usuario.** De los hallazgos de la auditoría original (`docs/13`), los de severidad ALTA/CRÍTICA relacionados con seguridad de red y transporte (maxPayload, comparación de tokens, protección de hello duplicado, validación de forma de mensajes) **ya están corregidos y probados con clientes reales**. Quedan dos gaps deliberadamente no resueltos en este milestone porque son trabajo de funcionalidad, no de estabilización: **autorización por usuario** (requiere Supabase Auth, Fase 2 del roadmap) y **auditoría completa de invocaciones manuales** (requiere un cambio de protocolo Edge Agent→Gateway). Ambos quedan documentados como condición explícita antes de cualquier despliegue más allá de un solo usuario en su propia máquina.
