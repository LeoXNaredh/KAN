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
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
  },
});
