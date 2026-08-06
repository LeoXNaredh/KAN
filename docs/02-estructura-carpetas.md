# Estructura de Carpetas

Monorepo gestionado con **Turborepo** + **pnpm workspaces** (ver ADR-002 en [00](00-analisis-y-decisiones.md)).

> **Estado real (fin de v0.1):** esta es la estructura que existe hoy en el repositorio, no un plan aspiracional — se actualizó tras el Milestone v0.1 (`docs/13-auditoria-v0.1.md`). Lo marcado como *(planeado)* todavía no se ha construido.

```
kan/
├── apps/
│   ├── web/                      # Next.js — chat + BFF, function-calling contra el Gateway
│   │   ├── app/                  # App Router (page.tsx, api/chat/route.ts)
│   │   └── lib/gateway/          # GatewayToolProvider (HTTP hacia apps/gateway)
│   ├── desktop/                  # Electron — hospeda el Edge Agent + UI de validación
│   │   └── src/{main,preload,renderer}/
│   ├── gateway/                  # Proceso Node persistente — el plano de control (ADR-009)
│   │   ├── src/server.ts         # http.Server compartido: HTTP /v1/* + WS /edge
│   │   └── src/http/routes.ts    # API pública del Gateway
│   ├── mobile/                   # (planeado, Fase 2) React Native
│   └── docs-site/                # (planeado, Fase 2) sitio de documentación pública
│
├── packages/
│   ├── core/                     # @kan/core — dominio + casos de uso (Clean Architecture)
│   │   ├── src/domain/entities/  # Conversation, Message (con soporte tool-calling)
│   │   ├── src/domain/ports/     # AIProviderPort, ConversationRepositoryPort, ToolProviderPort
│   │   ├── src/application/      # SendMessageUseCase (loop de tool-calling)
│   │   └── src/infra/            # InMemoryConversationRepository (Supabase: planeado)
│   │
│   ├── ai-abstraction/           # @kan/ai-abstraction — GeminiProvider + ModelRouter
│   │   └── src/providers/gemini/ # (Claude/GPT/local: planeados, mismo puerto)
│   │
│   ├── plugin-contract/          # @kan/plugin-contract — vocabulario neutral compartido
│   │   └── src/{severity,capability,deviceDriverPort,manifest,protocol,tool,auth}.ts
│   │
│   ├── plugin-sdk-ts/            # @kan/plugin-sdk-ts — KanPlugin / KanDeviceDriverPlugin
│   │
│   ├── edge-agent-core/          # @kan/edge-agent-core — lógica del Edge Agent
│   │   ├── src/application/      # PluginManager, DeviceManager, PermissionManager, CapabilityRegistry, EdgeAgentBus
│   │   └── src/infra/            # JsonFileConfigStore, FileAndConsoleLogger, CoreWebSocketClient, NoopUpdater
│   │
│   ├── gateway-core/              # @kan/gateway-core — lógica del Gateway (docs/12)
│   │   ├── src/application/       # AgentRegistry, GlobalCapabilityRegistry, TaskOrchestrator,
│   │   │                          # AuditService, ToolRegistry/Resolver/Executor, GatewayBus
│   │   └── src/infra/             # WsConnectionManager, JsonlAuditStore, NoopScheduler, ConsoleNotificationService
│   │
│   ├── db/                       # (planeado) esquema y cliente de Supabase
│   ├── ui/                       # (planeado) design system compartido
│   ├── config/                   # (planeado) eslint/tsconfig compartidos — hoy: eslint.config.mjs en la raíz
│   └── testing/                  # (planeado) utilidades de test compartidas — hoy: cada paquete tiene su propio vitest
│
├── plugins/
│   ├── plugin-device-simulator/  # El primer y único "dispositivo" real hoy — valida toda la infraestructura
│   ├── plugin-3d-printing/            # (planeado)
│   ├── plugin-cnc-laser/              # (planeado)
│   ├── plugin-esp32-arduino/          # (planeado — siguiente hito tras v0.1)
│   ├── plugin-raspberry-pi/           # (planeado)
│   ├── plugin-vision/                 # (planeado)
│   ├── plugin-cad/                    # (planeado)
│   ├── plugin-pcb/                    # (planeado)
│   ├── plugin-home-assistant/         # (planeado)
│   ├── plugin-telegram/               # (planeado)
│   ├── plugin-whatsapp/               # (planeado)
│   └── plugin-github/                 # (planeado)
│
├── sdk-python/                   # (planeado) kan-plugin-sdk-py
│
├── infra/                        # (planeado) supabase/, docker/, ci/
│
├── docs/                         # Arquitectura, ADRs, roadmap, backlog, auditorías, releases
│
├── eslint.config.mjs             # Config compartida (ESLint 9 flat config) para todo el monorepo excepto apps/web
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## Principios de esta estructura

- **`packages/core` no importa nada de `apps/` ni de `plugins/`.** Solo depende de `@kan/plugin-contract` (paquete neutral, sin dependencias). Verificado real en la auditoría de v0.1 (`docs/13`), no solo declarado.
- **`packages/edge-agent-core` NO depende de `@kan/core`.** Bounded context separado, confirmado — es lo que permite que el Edge Agent funcione sin que el Core Cloud exista.
- **Los plugins solo dependen de `plugin-sdk-ts`/`plugin-contract`.** Nunca de `apps/` ni de `edge-agent-core`/`gateway-core` directamente.
- **`plugins/` en este monorepo son solo los oficiales.** Los plugins de terceros (Fase 2, marketplace) vivirán en repos externos, consumiendo el mismo `plugin-contract`.
- Cada paquete tiene sus propios scripts `typecheck`/`lint`/`test`, orquestados por Turborepo (`pnpm turbo run <script>`) — confirmado funcionando sin errores en todo el árbol al cierre de v0.1.
