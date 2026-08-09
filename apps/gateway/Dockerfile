# syntax=docker/dockerfile:1
#
# Build context = raíz del repo (turbo prune necesita ver todo el workspace
# para poder recortarlo) — ver instrucciones de deploy en README.md.
#
#   docker build -f apps/gateway/Dockerfile -t kan-gateway .

# ---- 1. Poda el monorepo a solo lo que apps/gateway necesita (Turborepo) ----
FROM node:22-slim AS pruner
WORKDIR /app
RUN corepack enable
COPY . .
RUN npx turbo prune gateway --docker

# ---- 2. Instala dependencias — capa cacheable: solo se invalida si cambian
# los package.json/lockfile podados, no con cada cambio de código fuente ----
FROM node:22-slim AS installer
WORKDIR /app
RUN corepack enable
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile

# ---- 3. Copia el código fuente podado encima de node_modules ya instalado ----
FROM installer AS builder
COPY --from=pruner /app/out/full/ .

# ---- 4. Runtime — corre con tsx, igual que "pnpm dev" pero sin --watch.
# Ningún paquete del backend de este monorepo tiene paso de compilación
# (@kan/core, @kan/gateway-core, etc. publican su `main` como `src/*.ts`
# crudo, ver sus package.json) — tsx es el mismo mecanismo en dev y en
# producción, sin un pipeline de build nuevo que mantener. ----
FROM node:22-slim AS runner
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=builder /app .
WORKDIR /app/apps/gateway
EXPOSE 8787
CMD ["pnpm", "start"]
