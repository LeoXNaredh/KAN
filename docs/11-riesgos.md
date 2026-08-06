# Riesgos

> **Actualizado tras el Milestone v0.1**: `docs/13-auditoria-v0.1.md` (auditoría de código/arquitectura/concurrencia/performance/seguridad sobre el sistema real) y `docs/15-seguridad-v0.1.md` (reporte de seguridad formal) confirman y refinan varios de los riesgos técnicos de abajo con evidencia concreta del código, no solo previsión. En particular: el riesgo de "responsabilidad por daño físico" de la sección 3 ya tiene mitigación real y probada (ADR-004, `PermissionManager` con tests dedicados); el riesgo de autenticación/autorización sigue abierto y ahora está caracterizado con precisión (`docs/15` secciones 1-2).

## 1. Riesgos técnicos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El canal Core↔Edge Agent es la pieza más nueva y de mayor incertidumbre (nadie la ha construido en este proyecto) | Alto — puede retrasar el MVP entero | Se prioriza en la semana 2 de la Fase 1 (no al final), para descubrir problemas de arquitectura con tiempo de reaccionar |
| Un plugin de terceros con bug tumba el Edge Agent o corrompe el estado de un dispositivo | Alto | Aislamiento de proceso (sidecars), reinicio controlado, contratos versionados, pruebas de la Safety Layer (tarea 49) |
| Rate limits de Gemini free-tier bloquean uso real con varios usuarios | Medio | Model Router con fallback multi-proveedor desde el diseño (no parche posterior) |
| Límites de Supabase Free (pausas, 500MB) afectan continuidad en producción | Medio | Uso de Postgres estándar (sin lock-in a features de un tier) para migración simple a plan pago |
| Deriva entre el manifest declarado de un plugin y su comportamiento real | Medio | SDKs que generan el manifest desde el código (no se escribe a mano y a menudo diverge) |
| Latencia/timeout de funciones serverless de Vercel para operaciones largas | Medio | Nada que dependa de conexión larga vive en Vercel (reafirma el diseño del Edge Agent) |
| Explosión de complejidad si se implementa DDD completo antes de tiempo | Bajo-Medio | DDD ligero explícito para el MVP (ver doc 00, sección 4) |
| Fragmentación entre plataformas (web/mobile/desktop) por lógica duplicada | Medio | Monorepo + `@kan/core` compartido (ADR-002); ESLint boundaries para impedir imports cruzados indebidos |

## 2. Riesgos de negocio

| Riesgo | Impacto | Mitigación |
|---|---|---|
| El público objetivo real (makers/hobbyistas vs. industria) no está validado antes de construir | Alto | El MVP se valida con un nicho concreto (makers con ESP32/impresión 3D) antes de expandir a industrial/PLC |
| Costo de IA y de infraestructura escala con usuarios reales más rápido que los ingresos | Alto | Registro de costo por proveedor desde el MVP (tarea 12); modelo de precios se diseña antes de escalar adquisición |
| Dependencia de un ecosistema de plugins de terceros que nunca despega (marketplace vacío) | Medio | El equipo mantiene un set de plugins "oficiales" suficiente para valor standalone, el marketplace es incremental, no un requisito de lanzamiento |
| Competencia de plataformas ya establecidas de automatización (Home Assistant, OctoPrint, n8n) que podrían añadir IA conversacional | Medio | Diferenciación clara: KAN no reemplaza estas herramientas, se integra con ellas (ver `plugin-home-assistant`) y compite en la capa de orquestación por lenguaje natural, no en reconstruir lo que ya existe |
| Tiempo de desarrollo del Edge Agent y la Safety Layer alarga el time-to-market | Medio | Alcance del MVP deliberadamente recortado a un solo dispositivo (ESP32) para validar el loop completo rápido |

## 3. Riesgos legales

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Responsabilidad por daño material o lesión** causada por una acción de KAN sobre hardware físico (CNC, láser, robot) | **Alto** | Safety Layer con confirmación explícita obligatoria (ADR-004) para toda acción `irreversible-material`/`safety-critical`; términos de servicio claros sobre responsabilidad del usuario en la confirmación final; considerar seguro de responsabilidad civil antes de abrir a usuarios no técnicos con hardware peligroso (láser, CNC) |
| **Marketplace de terceros**: un plugin de un tercero causa daño y no está claro quién responde (KAN, el autor del plugin, el usuario) | Alto (Fase 2+) | Modelo de permisos + firma de código desde el diseño (ADR-008); términos legales de publicación que definan responsabilidad del autor del plugin; proceso de revisión antes de listar plugins que controlen hardware de alto riesgo |
| **Privacidad de datos** (conversaciones, imágenes de cámaras/sensores, ubicación de dispositivos domóticos) — aplica GDPR si hay usuarios en la UE | Medio-Alto | Procesamiento local cuando sea posible (frames de cámara no suben a la nube salvo necesidad, doc 06); política de privacidad clara; Supabase permite definir región de datos |
| **Certificación de seguridad de maquinaria** (CNC, láser, PLC industrial) — regulaciones varían por país y sector | Medio | KAN se posiciona como capa de control/orquestación, no como fabricante del equipo; el usuario/operador sigue siendo responsable del cumplimiento normativo del propio hardware; documentar esto explícitamente en términos de uso |
| **Uso por menores de edad** con hardware potencialmente peligroso (láser, CNC) | Medio | Restricciones de edad/perfil en el User Manager para categorías de dispositivo de alto riesgo (a definir con asesoría legal antes de Fase 2) |
| **Propiedad intelectual** de modelos 3D/PCB generados por IA (plugin CAD/PCB) — ambigüedad sobre titularidad | Bajo-Medio | Términos de servicio explícitos sobre titularidad del output generado; monitorear evolución regulatoria de IA generativa |
| **Exportación de tecnología** (software de control de CNC/robótica puede caer bajo regulaciones de doble uso en algunas jurisdicciones) | Bajo | Revisión legal puntual antes de expandir a mercados con controles de exportación estrictos; no es bloqueante para el MVP |

## 4. Principio general de gestión de riesgo para KAN

A diferencia de una app de software convencional, **el costo de un error en KAN puede ser físico, no solo un bug**. Por eso los riesgos legales y de seguridad no se tratan como una fase separada al final del proyecto — están entretejidos en la arquitectura misma (Safety Layer, severidad de acciones, confirmación explícita) desde la primera semana del MVP.
