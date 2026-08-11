export interface KANAccentPreset {
  id: string;
  label: string;
  hex: string;
}

// Debe reflejar exactamente los selectores `[data-kan-accent="..."]` de
// globals.css — "emerald" no tiene entrada porque es el default de :root
// (sin atributo), no un preset que sobreescriba nada.
export const KAN_ACCENT_PRESETS: KANAccentPreset[] = [
  { id: "emerald", label: "Verde esmeralda", hex: "#00ff9d" },
  { id: "gold", label: "Dorado", hex: "#f5a623" },
  { id: "blue", label: "Azul profundo", hex: "#0066ff" },
  { id: "red", label: "Rojo", hex: "#ff3333" },
  { id: "white", label: "Blanco", hex: "#ffffff" },
];

export const KAN_ACCENT_STORAGE_KEY = "kan:accent";
export const KAN_ACCENT_ATTRIBUTE = "data-kan-accent";

/**
 * Corre antes de hidratar (inline script en app/layout.tsx) para evitar el
 * flash del acento default al recargar con una preferencia guardada — mismo
 * criterio que cualquier theme-picker sin flash (leer localStorage
 * sincrónico, aplicar el atributo, recién ahí pintar). Nunca toca nada del
 * lado del servidor: es una preferencia 100% visual, sin tabla en Supabase.
 */
export const KAN_ACCENT_INLINE_SCRIPT = `(function(){try{var v=localStorage.getItem(${JSON.stringify(
  KAN_ACCENT_STORAGE_KEY,
)});if(v&&v!=="emerald")document.documentElement.setAttribute(${JSON.stringify(KAN_ACCENT_ATTRIBUTE)},v);}catch(e){}})();`;
