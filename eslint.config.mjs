// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * Config compartida para todo el monorepo excepto apps/web (que usa su
 * propio eslint.config.mjs con eslint-config-next, scaffold de create-next-app).
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "apps/web/**",
      "apps/gateway/data/**",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "warn",
      "no-console": "off",
    },
  },
);
