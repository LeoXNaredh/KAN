# Tecnologías: Recomendadas y Alternativas

## 1. Resumen de decisiones (detalle y justificación en ADRs, doc 00)

| Capa | Recomendado | Alternativas evaluadas | Justificación breve |
|---|---|---|---|
| Frontend Web | Next.js + React + TypeScript + TailwindCSS | — (ya definido en README, correcto) | SSR/SSG, ecosistema Vercel nativo |
| Backend/BFF | Next.js API Routes | NestJS separado | Suficiente para BFF; lógica real vive en `@kan/core`, no en el framework web |
| Mobile | **React Native (Expo)** | Flutter | Comparte lógica TS del monorepo (ADR-005) |
| Desktop | **Electron** (MVP) → evaluar Tauri en Fase 2 | Tauri desde el inicio | Ecosistema Node maduro para Serial/USB/BLE reduce riesgo temprano (ADR-006) |
| Base de datos | Supabase (Postgres + pgvector + Realtime + Auth + Storage) | Firebase, backend propio | Un solo proveedor cubre DB, auth, realtime y vectores; free tier apto para MVP |
| IA | Gemini (inicial), abstracción para Claude/GPT/local | — | Ya definido en README; se formaliza con `@kan/ai-abstraction` (ADR usa Vercel AI SDK como base) |
| Monorepo | Turborepo + pnpm workspaces | Nx | Turborepo más simple para empezar; Nx si la complejidad de generación de código crece |
| Comunicación Core↔Edge | WebSocket persistente + JSON contract versionado | MQTT broker centralizado, gRPC bidireccional | WS es suficiente y más simple de operar en Vercel; se reevalúa MQTT si el volumen de telemetría IoT crece mucho |
| Plugins pesados | Sidecars Python (FastAPI/gRPC), empaquetados como contenedor | WASM sandboxing | Python domina CV/CAD/robótica; WASM se reevalúa cuando exista marketplace público (aislamiento más fuerte) |
| CI/CD | GitHub Actions + Vercel (web) + release pipeline propio (desktop/mobile) | — | Estándar, integración directa con GitHub Flow del README |
| Observabilidad | Sentry (errores) + Vercel Analytics + logs estructurados (Edge Agent → Cloud) | Datadog | Costo/complejidad apropiados para MVP; Datadog si se necesita APM avanzado en Fase 2 |

## 1.1 Añadido durante v0.1 (Gateway + estabilización) — real, no planeado

| Pieza | Tecnología | Dónde |
|---|---|---|
| Servidor HTTP del Gateway | Express | `apps/gateway` |
| WebSocket (Edge Agent↔Gateway) | `ws` (modo `noServer`, compartiendo puerto con Express) | `packages/gateway-core/src/infra/WsConnectionManager.ts` |
| Runtime del Gateway en desarrollo | `tsx watch` (ejecuta TS directo, sin paso de build) | `apps/gateway` |
| Lint | ESLint 9 (flat config) + `typescript-eslint` — una config compartida en la raíz para todo el monorepo excepto `apps/web` (que mantiene su config de `eslint-config-next`) | `eslint.config.mjs` |
| Testing | Vitest en los 9 paquetes con lógica no trivial | cada `package.json` |
| Testing HTTP | `supertest` (rutas del Gateway) | `apps/gateway` |
| Empaquetado de escritorio | `electron-vite` (Vite para main/preload/renderer) | `apps/desktop` |
| Comparación de tokens segura | `node:crypto` `timingSafeEqual` | `packages/plugin-contract/src/auth.ts` |

**Decisión no tomada (y por qué):** se evaluó el Vercel AI SDK como capa base para `@kan/ai-abstraction` (mencionado en la versión original de este documento) y **no se adoptó** — la superficie real que necesitábamos (function-calling + texto simple contra un único proveedor) se implementó directo contra el SDK de Gemini sin ganar nada de la capa de abstracción adicional. Se reevalúa si/cuando se agregue un segundo proveedor real (Claude/GPT).

## 2. Notas sobre el free tier (honestidad de arquitecto)

- **Supabase Free**: proyecto se pausa tras 7 días de inactividad, 500MB de DB, 2 proyectos. Adecuado para desarrollo y demo con early adopters, no para producción con usuarios reales concurrentes. La migración a Pro es solo configuración si evitamos features exclusivas de un tier (cumplido por diseño).
- **Gemini Free**: límites de requests/minuto bajos para uso multiusuario real. Mitigado por el Model Router con fallback (doc 05) desde el primer sprint, no como parche posterior.
- **Vercel Free/Hobby**: límites de duración de función serverless (10s en Hobby) — otra razón más para que nada que dependa de conexiones largas viva en Vercel (reafirma ADR-001).

## 3. Librerías clave por dominio (referencia, no exhaustivo)

- **Serial/USB (Edge Agent, Node):** `serialport`, `node-usb`
- **BLE (Edge Agent, Node):** `@abandonware/noble`
- **G-code / CNC:** parsers y simuladores existentes en el ecosistema GRBL antes de escribir uno propio
- **Visión artificial (Python sidecar):** OpenCV, modelos ONNX/PyTorch según el caso
- **CAD (Python sidecar):** evaluar `build123d`/`CadQuery` (paramétrico, scriptable) antes de motores propios
- **Vector store:** `pgvector` sobre Supabase (evita operar un vector DB separado en el MVP)
