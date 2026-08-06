# Informe Técnico — Cierre del Milestone v0.1

**Rol:** CTO / Lead Engineer
**Fecha:** 2026-08-06
**Alcance:** auditoría completa, testing, performance, seguridad, documentación, diagramas, changelog, release notes, ADRs, revisión de arquitectura y quality gates sobre todo lo construido hasta ahora — sin agregar funcionalidades nuevas.

---

## 1. Estado del proyecto

KAN tiene, por primera vez, el **loop completo funcionando de punta a punta**: un usuario escribe en el chat, un LLM (Gemini) propone qué herramienta usar, el sistema la resuelve y ejecuta contra un dispositivo real a través de una arquitectura de plano de control con permisos de seguridad, y la respuesta vuelve al chat con el resultado visible. Hoy ese "dispositivo real" es un simulador — deliberadamente, para probar toda la infraestructura antes de arriesgar hardware físico.

**Lo que existe y funciona, verificado (no solo declarado):**

| Pieza | Estado |
|---|---|
| Chat con Gemini + historial de conversación | ✅ Funcional |
| Function-calling real (el LLM propone, el sistema decide y ejecuta) | ✅ Funcional, probado en vivo y con tests |
| Gateway — plano de control con 10 módulos diseñados | ✅ 7 implementados y probados, 2 como seams documentados (Scheduler, Notification), 1 (desambiguación multi-dispositivo) documentado como propuesta |
| Edge Agent — Plugin/Device/Permission Manager, Safety Layer (ADR-004) | ✅ Funcional, probado con confirmación aprobada y rechazada |
| Device Simulator | ✅ Funcional, con validación de input corregida en esta fase |
| Auditoría, lint, tests | ✅ 102 tests, 0 errores/warnings de lint, typecheck limpio en 10 paquetes |

**Lo que no existe todavía** (detalle completo en `RELEASE_NOTES_v0.1.md`): ningún dispositivo físico real, autenticación de usuario, persistencia real (Supabase), memoria de largo plazo, app móvil, CI/CD, marketplace. Ninguno de estos es un descuido — todos están explícitamente fuera de alcance de v0.1 y documentados en el roadmap.

**Veredicto:** la base es sólida y honesta consigo misma. No hay deuda técnica escondida bajo la alfombra — todo lo que falta está escrito, priorizado, y la razón de por qué falta está documentada.

---

## 2. Calidad del código

Metodología: tres auditorías independientes en paralelo (calidad/arquitectura, concurrencia/performance, seguridad — `docs/13-auditoria-v0.1.md`) sobre el código real, no sobre la documentación de cómo debería ser.

**Hallazgos principales confirmados:**
- El grafo de dependencias real respeta las reglas documentadas (`@kan/core` solo depende de `@kan/plugin-contract`; `edge-agent-core` no depende de `@kan/core`; los plugins solo dependen del SDK) — verificado leyendo cada `package.json`, no asumido.
- Sin dependencias circulares, sin duplicación de código no intencional.
- Ninguna clase sobredimensionada al punto de necesitar partirse.

**11 hallazgos de severidad ALTA, todos corregidos en esta fase** (detalle en `docs/13`): dos bugs de correctness reales en el simulador (`Boolean("false") === true`, `NaN` corrompiendo estado permanentemente), tres memory leaks (`TaskOrchestrator.tasks`, `PermissionManager.pending`, límite de payload WS ausente), dos problemas de robustez de protocolo (conexiones duplicadas/zombie en `WsConnectionManager`), dos problemas de manejo de errores (race condition de IPC en el Edge Agent, errores silenciados en la UI), y dos problemas de resiliencia de red (`fetch` sin timeout pudiendo colgar el chat, `SendMessageUseCase` sin límite de duración).

**1 hallazgo CRÍTICO, aceptado conscientemente para v0.1:** ausencia de autenticación de usuario. No es un bug — es una funcionalidad que no se ha construido todavía, correctamente fuera de alcance de un milestone de estabilización (requiere Supabase Auth, ya en el roadmap de Fase 2).

**Cobertura de tests: 102 tests en 9 paquetes**, con foco deliberado en las partes críticas en vez de cobertura total:
- El límite de red real (`WsConnectionManager`) se prueba con clientes WebSocket reales, no mocks — la decisión de mayor valor de la fase de testing (ADR-012).
- La Safety Layer (`PermissionManager`, ADR-004) tiene cobertura completa incluyendo la expiración TTL de confirmaciones ignoradas.
- El loop completo de tool-calling (`SendMessageUseCase`) está probado incluyendo el caso límite de que el LLM nunca deje de proponer tools (corte por `MAX_TOOL_ROUNDS`).

**Quality gates:** `pnpm turbo run lint typecheck test` — 0 errores, 0 warnings, en los 10 paquetes del monorepo. `pnpm turbo run build` limpio para `apps/web` y `apps/desktop` (`apps/gateway` corre vía `tsx`, sin paso de build todavía — ver deuda técnica).

---

## 3. Riesgos

Consolidado de `docs/13` (auditoría general), `docs/15` (seguridad formal) y `docs/11` (riesgos originales, ahora referenciados con evidencia real):

| Riesgo | Severidad | Estado |
|---|---|---|
| Sin autenticación de usuario — cualquiera con acceso a la máquina/red controla los dispositivos conectados | **Crítico** (para uso compartido) / Aceptable (para un solo usuario local) | Documentado, propuesta concreta en `docs/16` P2, no implementado |
| `inputSchema` de capabilities sin validación JSON Schema real | Alto de cara al roadmap | El simulador ya valida a mano tras esta fase; **recomendado bloquear ESP32/CNC hasta resolver esto de forma genérica** (`docs/16` P1) |
| Sin rate limiting en el Gateway | Medio, sube a alto si se abre a terceros | Aceptable para un solo Edge Agent local |
| Auditoría incompleta (invocaciones manuales del Edge Agent no llegan al audit trail del Gateway) | Medio | Propuesta concreta en `docs/16` P4 |
| Sin persistencia real — todo en memoria/archivo local | Medio (durabilidad) | Decisión consciente (ADR-007), puertos ya listos para el swap |
| Prompt injection vía resultado de una tool que vuelve al LLM | Bajo hoy, sube con plugins de visión/OCR futuros | Mitigación arquitectónica ya existe (ADR-004: confirmación humana obligatoria para severidad alta, independiente de lo que diga el LLM) |

**Ninguno de estos riesgos bloquea el uso actual en desarrollo local de un solo usuario.** El primero (autenticación) y el segundo (validación de input) son las dos condiciones reales antes de, respectivamente, compartir el sistema con más de una persona y conectar el primer dispositivo con consecuencias físicas de verdad.

---

## 4. Deuda técnica

Deuda **reconocida y documentada** (no descubierta por accidente):

1. **`ModelRouter` sin fallback real** — la interfaz está lista, no hay un segundo proveedor de IA implementado al que caer (`docs/13` M11).
2. **`GlobalCapabilityRegistry`/`JsonFileConfigStore` con operaciones O(n)/reescritura completa** — irrelevantes a la escala actual (1 agente, 3 capabilities), documentadas para cuando dejen de serlo (`docs/13` M8, M13).
3. **`apps/gateway` sin script de `build`** — corre vía `tsx watch` en desarrollo; no hay un paso de compilación para producción todavía. Detectado durante los quality gates de esta fase, no resuelto (fuera de alcance: "no nuevas funcionalidades").
4. **`LoggerPort` inconsistente entre `edge-agent-core` (lo tiene) y `gateway-core` (usa `console` directo)** — higiene, no bug (`docs/16` P8).
5. **Sin rotación de logs** en el Edge Agent — el archivo crece sin límite (`docs/13` L5).
6. **8 propuestas de mejora arquitectónica** documentadas en detalle con costo y prioridad estimados en `docs/16-arquitectura-propuestas-v0.1.md`, ninguna implementada por decisión explícita de este milestone.

**Lo que NO es deuda técnica, aunque lo parezca a primera vista:** la falta de Supabase, memoria/RAG, app móvil, y multi-agente. Son funcionalidades del roadmap todavía no alcanzadas, no atajos tomados bajo presión — la distinción importa porque cambia la urgencia de resolverlas.

---

## 5. Próximos pasos recomendados (con prioridad)

| # | Paso | Prioridad | Bloqueante para |
|---|---|---|---|
| 1 | Validación JSON Schema real de `inputSchema` (`docs/16` P1) | **Alta** | Cualquier plugin de hardware real |
| 2 | `plugin-esp32-arduino` — primer dispositivo físico real | **Alta** | Es el objetivo explícito del usuario tras este milestone |
| 3 | Autenticación de usuario (Supabase Auth + autorización por dueño de Edge Agent, `docs/16` P2) | Alta | Compartir el sistema con más de un usuario |
| 4 | Auditoría completa de invocaciones manuales (`docs/16` P4) | Media | Completitud de compliance |
| 5 | Persistencia real del Gateway (audit trail en Supabase, `docs/16` P3) | Media | Durabilidad ante reinicios |
| 6 | Streaming de respuestas del chat (`docs/16` P7) | Baja hoy, sube al conectar dispositivos con operaciones largas | UX una vez existan impresoras/CNC reales |
| 7 | Rate limiting en el Gateway (`docs/16` P6) | Baja hoy, sube al abrir a terceros | Marketplace (Fase 2+) |
| 8 | Desambiguación multi-dispositivo / tareas compuestas (`docs/16` P5) | Baja | Sin caso de uso real todavía |
| 9 | `LoggerPort` compartido, script de build para `apps/gateway` | Muy baja | Higiene |

**Recomendación concreta de secuencia:** pasos 1 y 2 juntos (la validación de input es literalmente condición de seguridad para el paso 2, no un "nice to have" separado) — construir `plugin-esp32-arduino` reutilizando exactamente la infraestructura ya validada con el simulador, sin tocar `packages/edge-agent-core` ni `packages/gateway-core`. Eso es, en sí mismo, la prueba de que la arquitectura de plugins cumple su promesa central.

---

## 6. Cierre

KAN entra al desarrollo del primer dispositivo físico con: arquitectura auditada por tres ángulos distintos, 102 tests cubriendo las partes que importan, cero deuda técnica oculta, un reporte de seguridad formal con cada hallazgo resuelto o conscientemente diferido con su razón documentada, y una lista clara de qué construir después y en qué orden. Esto es exactamente lo que se pidió: una base sólida y mantenible antes de continuar con ESP32, Arduino, robots, CNC e impresoras 3D — no una demo, una plataforma.
