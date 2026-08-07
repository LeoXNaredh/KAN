// @ts-check
import baseConfig from "../../eslint.config.mjs";

/**
 * apps/mobile necesita globals de Node/CommonJS para sus archivos de config
 * (babel.config.js, metro.config.js, tailwind.config.js) — convención del
 * ecosistema Expo/Metro, a diferencia del resto del monorepo que es TS/ESM
 * (ADR-013, docs/00). Mismo criterio que apps/web mantiene su propia config.
 */
export default [
  ...baseConfig,
  {
    files: ["babel.config.js", "metro.config.js", "tailwind.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
