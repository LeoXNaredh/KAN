# Performance — Milestone v0.1

> Medido contra el sistema real corriendo en local (Gateway + Edge Agent con el Device Simulator conectado), no contra un entorno de carga simulada — v0.1 es de un solo usuario, sin tráfico de producción todavía. El objetivo de este documento es dejar una línea base honesta y señalar los cuellos de botella ya identificados (algunos ya corregidos en la Fase 3 de estabilización, `docs/13-auditoria-v0.1.md`), no presentar benchmarks de carga que no reflejarían un escenario real.

## 1. Latencia medida en vivo

Mediciones tomadas contra el Gateway real (`apps/gateway`) con un Edge Agent (`apps/desktop`) conectado y el `plugin-device-simulator` activo, 5 muestras por endpoint tras el primer request (se descarta la primera muestra — incluye el costo de establecer la conexión TCP/keep-alive, no representativo de uso continuo):

| Operación | Ruta / mecanismo | Latencia observada (steady state) |
|---|---|---|
| Listar tools disponibles | `GET /v1/tools` (lee `GlobalCapabilityRegistry` en memoria) | ~18–20ms |
| Ejecutar una capability, round-trip completo | `POST /v1/tools/:name/execute` → Gateway → WS → Edge Agent → `DeviceSimulatorPlugin` → telemetría de vuelta → respuesta HTTP | ~25–29ms |

**Lectura de estos números:** el 100% del tiempo del segundo caso (~25-29ms) es overhead de red/serialización local — el propio `DeviceSimulatorPlugin.invoke()` es síncrono e instantáneo. Este es el número que importa cuando se conecte un dispositivo real: la latencia real del sistema será `overhead_de_transporte (~25ms) + tiempo_real_del_dispositivo` (que para un motor paso a paso o una impresora será órdenes de magnitud mayor que el propio transporte).

## 2. Tiempo de conexión del Edge Agent

De los logs reales de arranque de `apps/desktop` (sesión de este milestone):

```
18:48:57.454  Plugin cargado: kan-plugin-device-simulator
18:48:57.462  Dispositivo conectado: Dispositivo Simulado #1 (simulator-1)   [+8ms]
18:48:57.519  Edge Agent listo                                              [+57ms]
18:48:57.600  Conectado al Core Cloud                                       [+81ms desde el arranque]
```

De "arranque del proceso Electron" a "conectado al Gateway": **~150-200ms** en total (incluye carga de Electron, no solo la lógica del Edge Agent — el propio handshake WS + hello + sync de capabilities una vez el proceso está arriba toma bajo 100ms). No es un número preocupante para un cliente de escritorio que arranca una vez y queda corriendo.

## 3. Consumo de memoria

| Proceso | Working Set observado |
|---|---|
| Gateway (`apps/gateway`, modo dev con `tsx watch`) | ~19MB |
| Edge Agent (`apps/desktop`, proceso Electron completo: main + renderer + GPU) | ~65-90MB agregado |

El consumo del Gateway es bajo y dominado por el runtime de Node, no por estado acumulado (ver hallazgos de memoria del punto 5). El del Edge Agent está dominado por el baseline de Chromium/Electron (típico de cualquier app Electron, incluso una en blanco) — no es una señal útil sobre la eficiencia de `edge-agent-core` en sí. En modo producción (`electron-vite build`, sin el overhead de HMR/dev server) el consumo baja, pero no se remidió formalmente en este milestone.

## 4. Rendimiento del Event Bus

`EdgeAgentBus`/`GatewayBus` son wrappers delgados sobre `node:events`. No se detectó ninguna ruta donde el bus mismo sea el cuello de botella — el costo real en cada operación de la suite de tests (102 tests, `pnpm turbo run test`, ~5-15s incluyendo transform/collect de Vitest, tests en sí <1s en total) está dominado por I/O simulado (setTimeout en los fakes), no por el despacho de eventos. No se identificó necesidad de optimizar el bus para v0.1.

## 5. Cuellos de botella identificados (referencia cruzada con `docs/13`)

| Hallazgo | Estado | Impacto en performance |
|---|---|---|
| A8 — `appendFileSync` en el hot path del Audit Service | **Corregido en Fase 3** | Antes bloqueaba el único hilo del Gateway en cada ejecución de tool; ahora escritura asíncrona + lectura desde memoria |
| M9 — `JsonlAuditStore.list()` releía el archivo completo en cada `GET /v1/audit` | **Corregido en Fase 3** (mismo fix que A8: ahora todo se sirve desde el array en memoria) | Antes escalaba linealmente con el tamaño histórico del log en cada request |
| M12 — `DeviceManager.discoverAll()` secuencial entre drivers | **Corregido en Fase 3** (paralelizado con `Promise.all`) | Con 1 driver (el simulador) no había diferencia medible; importa en cuanto haya varios drivers reales |
| M8 — `GlobalCapabilityRegistry.resolve()`/`list()` son O(n) sin índice | **No corregido — documentado como deuda** | Irrelevante a la escala actual (1 agente, 3 capabilities); un `Map` indexado por `ref` sería el fix cuando el número de Edge Agents conectados crezca más allá de una demo |
| M13 — `JsonFileConfigStore` reescribe el archivo completo en cada `set()` | **No corregido — documentado como deuda** | Frecuencia de uso muy baja (habilitar/deshabilitar plugin), no vale la pena optimizar todavía |
| H5 (del audit de concurrencia) — sin timeout global en `SendMessageUseCase` | **Corregido en Fase 3** (A11: límite de duración total de 45s) | Evita que una cadena de rondas de tool-calling se acerque al límite de una función serverless |

## 6. Qué NO se midió en este milestone (y por qué)

- **Carga concurrente** (múltiples usuarios/chats simultáneos contra un mismo Gateway): v0.1 es de un solo usuario local — no hay un escenario real que perfilar todavía. Recomendado antes de cualquier despliegue compartido (ver `docs/13` C1, requiere Supabase Auth primero de todos modos).
- **Múltiples Edge Agents conectados simultáneamente**: el diseño lo soporta (`AgentRegistry`/`GlobalCapabilityRegistry` están indexados por `edgeAgentId`), pero no se probó con más de uno real. `WsConnectionManager.test.ts` sí prueba explícitamente el caso de dos conexiones reclamando el mismo `edgeAgentId` (colisión), pero no un volumen alto de agentes distintos simultáneos.
- **Latencia de Gemini**: fuera del control de KAN; no se midió porque depende enteramente de la API externa y de qué modelo se use. `SendMessageUseCase` ya tiene un límite de duración total (A11) que acota el peor caso independientemente de cuánto tarde el proveedor.
- **Profiling de CPU/heap con herramientas dedicadas** (`--inspect`, flame graphs): no se hizo — a esta escala (procesos de <20MB, latencias de <30ms) no hay señal de que exista un problema de CPU que perfilar. Se recomienda revisitar si `docs/13` M8 (scan O(n) del catálogo de capabilities) se vuelve medible con más Edge Agents conectados.
