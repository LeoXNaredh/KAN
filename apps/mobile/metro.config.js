const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// node:crypto (docs/18, incremento 2) — @kan/core (Message.ts) importa
// `randomUUID` de "node:crypto", correcto para sus consumidores reales
// (apps/web, tests bajo Node) pero inexistente en Hermes/RN. Se resuelve
// solo acá, sin tocar @kan/core.
const NODE_CRYPTO_POLYFILL = path.resolve(__dirname, "polyfills/node-crypto.js");
const { resolveRequest: defaultResolveRequest } = config.resolver;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "node:crypto" || moduleName === "crypto") {
    return { type: "sourceFile", filePath: NODE_CRYPTO_POLYFILL };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
