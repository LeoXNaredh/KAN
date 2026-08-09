import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// Los paquetes @kan/* del workspace se distribuyen como fuente TS (sin build
// propio), así que deben empaquetarse aquí en vez de externalizarse como el
// resto de node_modules — de lo contrario Electron intentaría requerir un
// .ts en runtime.
const WORKSPACE_PACKAGES = [
  "@kan/edge-agent-core",
  "@kan/plugin-contract",
  "@kan/plugin-sdk-ts",
  "@kan/plugin-device-simulator",
  "@kan/plugin-esp32-arduino",
  // Dependencia transitiva de plugin-esp32-arduino/plugin-serial-generic/
  // plugin-canbus — si se deja afuera, queda igual de externalizada y falla
  // en runtime con el mismo ERR_UNKNOWN_FILE_EXTENSION que un @kan/* sin
  // listar acá.
  "@kan/serial-line-transport",
  "@kan/plugin-http-generic",
  "@kan/plugin-ws-generic",
  // plugin-home-assistant importa @kan/plugin-http-generic internamente
  // (reusa su transporte) — sin listarlo acá, esa importación transitiva
  // también falla en runtime aunque plugin-http-generic ya esté arriba.
  "@kan/plugin-home-assistant",
  "@kan/plugin-modbus",
  "@kan/plugin-network-tools",
  "@kan/plugin-ssh",
  "@kan/plugin-opcua",
  "@kan/plugin-serial-generic",
  "@kan/plugin-canbus",
];

// `externalizeDepsPlugin` solo lee `dependencies`/`peerDependencies` del
// package.json de este paquete — no ve `cpu-features`, una dependencia
// opcional nativa de `ssh2` (transitiva vía @kan/plugin-ssh, ni siquiera
// directa de acá) cuyo build ya se denegó a propósito en
// pnpm-workspace.yaml (ADR-049: aceleración de crypto opcional, ssh2
// funciona igual sin ella). Sin excluirla acá, Rollup intenta resolver en
// serio el `.node` que ese build denegado nunca generó y el build entero
// falla — confirmado en vivo con `electron-vite build`, no algo hipotético.
// `proper-lockfile` — dependencia opcional (nunca instalada, `pnpm install`
// no la trae) de `@ster5/global-mutex`, transitiva de `node-opcua`
// (@kan/plugin-opcua). Mismo problema que `cpu-features`: ni instalada ni
// declarada acá, Rollup igual intenta resolverla al bundlear. Confirmado
// que `node-opcua` funciona igual sin ella (ADR-050: tests reales contra
// un servidor OPC-UA embebido, sin instalarla).
const NEVER_BUNDLE = ["cpu-features", "proper-lockfile"];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: { rollupOptions: { external: NEVER_BUNDLE } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: { rollupOptions: { external: NEVER_BUNDLE } },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
  },
});
