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
  "@kan/plugin-mqtt",
  "@kan/plugin-gcode",
  // Mismo motivo que el resto de la lista — confirmado en vivo, no era (como
  // se creyó al principio) una limitación de hardware/binding nativo: el
  // "No se pudo cargar el plugin de Raspberry Pi... ERR_UNKNOWN_FILE_EXTENSION"
  // pasaba porque este paquete quedaba afuera de WORKSPACE_PACKAGES, así que
  // Rollup lo externalizaba y Node intentaba requerir su `main` (`src/index.ts`)
  // crudo. `apps/desktop/src/main/index.ts` YA lo importa con el mismo patrón
  // dinámico + try/catch que ESP32/BLE — el problema era puramente de bundling.
  "@kan/plugin-raspberry-pi",
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
// `@abandonware/noble` — mismo problema, mismo criterio (ADR-060): es
// `optionalDependencies` de `@kan/edge-agent-core` (subpath `./ble`), no de
// este package.json, así que `externalizeDepsPlugin` no la ve. Su binding
// nativo (`@abandonware/bluetooth-hci-socket`) ya se denegó a propósito en
// pnpm-workspace.yaml (`allowBuilds: false` — el intento previo para
// plugin-bluetooth-generic falló por falta de Visual Studio C++, ver su
// README) — sin externalizarla acá, Rollup intenta resolver en serio el
// `.node` que ese build denegado nunca generó y el build entero falla
// (confirmado en vivo, no hipotético). Externalizada, el `import()`
// dinámico + try/catch de `main/index.ts` sí llega a ejecutarse en runtime
// y degrada a `NullBleScanner` como corresponde.
//
// `serialport` — mismo problema de fondo, hallazgo real al correr
// `apps/desktop` de punta a punta por primera vez en este entorno (ADR-060):
// es transitiva de `@kan/serial-line-transport`/`@kan/plugin-esp32-arduino`/
// etc. (todas workspace packages, ya bundleadas por WORKSPACE_PACKAGES), así
// que `externalizeDepsPlugin` tampoco la ve — Rollup la bundlea igual, y el
// binding nativo N-API de `@serialport/bindings-cpp` (que ADR-057 ya
// verificó ABI-estable y funcional bajo Electron **sin bundlear**) pierde su
// resolución relativa al `.node` una vez concatenado dentro de
// `out/main/index.js`, con el mismo error "No native build was found" que
// noble/cpu-features. Confirmado en vivo, dos formas: (1) requerido directo
// bajo `ELECTRON_RUN_AS_NODE=1` desde su ubicación real en `node_modules`
// (sin bundlear) — `SerialPort.list()` funciona perfecto; (2) el mismo
// código, ya bundleado en un chunk dinámico separado — falla con el error de
// arriba. Externalizada acá, Rollup deja un `require("serialport")` plano
// que Node resuelve en runtime contra el `node_modules` real — mismo
// mecanismo que ya prueba (1).
// `onoff`/`epoll` — mismo criterio que `@abandonware/noble` de arriba: al
// agregar `@kan/plugin-raspberry-pi` a WORKSPACE_PACKAGES (arriba), Rollup
// ahora también intenta bundlear su dependencia `onoff`, que a su vez trae
// `epoll` (binding nativo Linux-only, `allowBuilds: false` en
// pnpm-workspace.yaml a propósito — no compila en Windows/Mac). Sin
// externalizar ambos acá, el build entero vuelve a romperse igual que con
// noble/cpu-features. Externalizados, el import dinámico + try/catch de
// `main/index.ts` (ya existente, ver `OnoffGpioPort.ts`) degrada en runtime
// sin tumbar el resto del Edge Agent — mismo mecanismo que BLE.
const NEVER_BUNDLE = ["cpu-features", "proper-lockfile", "@abandonware/noble", "serialport", "onoff", "epoll"];

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
