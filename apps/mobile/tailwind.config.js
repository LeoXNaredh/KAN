/**
 * Tokens copiados a mano de DESIGN_SYSTEM.md / apps/web/app/globals.css
 * (ADR-031, docs/00 y docs/18 §4) — NativeWind v4 (estable) espera el
 * formato de Tailwind v3 (este archivo), mientras que apps/web ya migró a
 * Tailwind v4 CSS-first (`@theme` en globals.css, sin tailwind.config.js).
 * Duplicación consciente hasta que NativeWind v5 (CSS-first) sea el
 * default — no un paquete de tokens compartido todavía.
 *
 * Solo la paleta oscura (apps/web fuerza dark hoy, la paleta clara está
 * definida pero sin usar — mismo estado acá).
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  content: ["./App.tsx", "./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./lib/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        surface: "#05070a",
        "surface-2": "#0b0e14",
        "surface-3": "#12161f",
        line: "#1f2430",
        "line-strong": "#2a3040",
        ink: "#e6e9ef",
        "ink-muted": "#9aa3b2",
        "ink-faint": "#5b6472",
        accent: "#0ea5e9",
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ef4444",
      },
    },
  },
  plugins: [],
};
