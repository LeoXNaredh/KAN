# Estructura de Carpetas

Monorepo gestionado con **Turborepo** + **pnpm workspaces** (ver ADR-002 en [00](00-analisis-y-decisiones.md)).

```
kan/
├── apps/
│   ├── web/                      # Next.js — app web (BFF incluido)
│   │   ├── app/                  # App Router
│   │   ├── app/api/              # API routes (BFF hacia @kan/core)
│   │   └── ...
│   ├── mobile/                   # React Native (Expo)
│   ├── desktop/                  # Electron — UI de escritorio + hospeda el Edge Agent
│   │   ├── src/main/             # Proceso principal Electron
│   │   ├── src/edge-agent/       # Ver packages/edge-agent-core (se consume aquí)
│   │   └── src/renderer/         # UI (reutiliza componentes de @kan/ui)
│   └── docs-site/                # (Fase 2) sitio de documentación pública
│
├── packages/
│   ├── core/                     # @kan/core — dominio + casos de uso (Clean Architecture)
│   │   ├── src/domain/           # Entidades: Conversation, Device, Plugin, Permission, AgentTask, User
│   │   ├── src/application/      # Casos de uso / servicios de aplicación
│   │   └── src/ports/            # Interfaces (puertos) que implementa infra
│   │
│   ├── ai-abstraction/           # @kan/ai — interfaz común de proveedores de IA
│   │   ├── src/providers/gemini/
│   │   ├── src/providers/claude/
│   │   ├── src/providers/gpt/
│   │   ├── src/providers/local/
│   │   └── src/router.ts         # selección/fallback entre proveedores
│   │
│   ├── plugin-sdk-ts/            # SDK para plugins TypeScript in-process
│   ├── plugin-contract/          # Esquema de manifest + protocolo de mensajes (compartido TS/Python)
│   ├── device-protocol/          # Contratos de comunicación Core↔Edge Agent↔Dispositivo
│   ├── edge-agent-core/          # Lógica del Edge Agent (Device Manager, Safety Layer, cola offline)
│   ├── db/                       # Esquema y cliente de Supabase (migraciones, tipos generados)
│   ├── ui/                       # Design system compartido (web + desktop; RN usa su propio pero mismos tokens)
│   ├── config/                   # eslint, tsconfig, tailwind config compartidos
│   └── testing/                  # utilidades de test compartidas
│
├── plugins/                      # Plugins "oficiales" mantenidos por el equipo (no de terceros)
│   ├── plugin-3d-printing/            # TS (in-process) — orquesta, delega slicing a sidecar si aplica
│   ├── plugin-cnc-laser/              # TS + sidecar Python (G-code, dry-run/simulación)
│   ├── plugin-esp32-arduino/          # TS (in-process) — Serial/USB vía Edge Agent
│   ├── plugin-raspberry-pi/           # TS
│   ├── plugin-vision/                 # Python sidecar (OpenCV / modelos de detección)
│   ├── plugin-cad/                    # Python sidecar (generación de modelos 3D)
│   ├── plugin-pcb/                    # Python/TS sidecar
│   ├── plugin-home-assistant/         # TS (in-process, HTTP/WS a HA)
│   ├── plugin-telegram/               # TS (in-process)
│   ├── plugin-whatsapp/               # TS (in-process)
│   ├── plugin-github/                 # TS (in-process)
│   └── _template/                     # plantilla para crear plugins nuevos (TS y Python)
│
├── sdk-python/                   # kan-plugin-sdk-py — paquete pip para plugins Python
│
├── infra/
│   ├── supabase/                 # config local de Supabase, políticas RLS
│   ├── docker/                   # Dockerfiles de sidecars Python
│   └── ci/                       # workflows de GitHub Actions
│
├── docs/                         # Este directorio — arquitectura, ADRs, roadmap, backlog
│
├── turbo.json
├── pnpm-workspace.yaml
└── README.md
```

## Principios de esta estructura

- **`packages/core` no importa nada de `apps/` ni de `plugins/`.** La dependencia va siempre hacia adentro (Clean Architecture).
- **Los plugins nunca importan de `apps/`.** Solo dependen de `plugin-sdk-ts` / `kan-plugin-sdk-py` y `plugin-contract`. Esto es lo que hace posible que un plugin de terceros se instale sin tener acceso al código de la app.
- **`plugins/` en este monorepo son solo los oficiales.** Los plugins de terceros (Fase 2, marketplace) viven en repos externos y se distribuyen como paquetes firmados, consumiendo el mismo `plugin-contract`.
- Cada carpeta de `apps/` y `packages/` es "aplicable en aislamiento": se puede testear y compilar sin levantar todo el monorepo (gracias a Turborepo cache y límites de dependencia estrictos vía ESLint boundaries).
