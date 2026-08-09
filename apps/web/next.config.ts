import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Todos los paquetes workspace:* consumidos acá: cada uno publica su
  // `main`/`types` apuntando a `src/*.ts` crudo (sin paso de compilación,
  // ver sus package.json), así que Next necesita transpilarlos igual que su
  // propio código en vez de tratarlos como node_modules ya compilado.
  // @kan/supabase-adapter y @kan/voice-abstraction faltaban acá — el build
  // local con Turbopack los resolvía igual (verificado con `next build`
  // repetidas veces en esta sesión), pero es un supuesto silencioso del
  // bundler, no una garantía — se agregan para no depender de eso en Vercel.
  transpilePackages: [
    "@kan/core",
    "@kan/ai-abstraction",
    "@kan/plugin-contract",
    "@kan/edge-agent-core",
    "@kan/plugin-sdk-ts",
    "@kan/plugin-device-simulator",
    "@kan/supabase-adapter",
    "@kan/voice-abstraction",
  ],
};

export default nextConfig;
