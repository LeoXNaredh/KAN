import type { KANActivity } from "@/lib/kan/useKANState";

const CORE_ANIMATION: Record<KANActivity, string> = {
  idle: "kan-core-idle",
  listening: "kan-core-listening",
  thinking: "kan-core-thinking",
  speaking: "kan-core-speaking",
};

const SIZE_CLASSES = {
  lg: "h-52 w-52 sm:h-60 sm:w-60",
  sm: "h-16 w-16 sm:h-20 sm:w-20",
} as const;

/**
 * Núcleo animado de KAN — el elemento central de la identidad visual
 * (rediseño Kukulkán, referencia JARVIS): un anillo continuo de base con
 * segmentos angulares más brillantes girando encima (geometría maya, sin
 * SVG ni librería — `.kan-ring`/`.kan-ring-base` en globals.css) alrededor
 * de una grilla HUD tipo mira/radar, un halo intenso que se difumina bien
 * hacia afuera del propio borde del avatar, y un núcleo de vidrio
 * (translúcido + blur, no un disco sólido) con "KAN" legible en el centro.
 * Puramente presentacional: quién orquesta tamaño/posición (centro vs.
 * esquina) es `KANLayout`, no este componente — así el mismo avatar sirve
 * para el catálogo de `/design-system` sin arrastrar layout.
 */
export function KANAvatar({
  size = "lg",
  activity = "idle",
  className = "",
}: {
  size?: "lg" | "sm";
  activity?: KANActivity;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={`KAN — ${ACTIVITY_LABEL[activity]}`}
      className={`relative flex shrink-0 items-center justify-center ${SIZE_CLASSES[size]} ${className}`}
    >
      {/* Nebulosa — capa exterior extra, mucho más ancha y suave que el halo de abajo, para que el glow se disuelva gradualmente en vez de cortar en un borde de blur visible. */}
      <span
        aria-hidden="true"
        className="absolute -inset-16 rounded-full blur-[80px] transition-opacity duration-base sm:-inset-24"
        style={{
          background: "radial-gradient(circle, var(--color-accent), transparent 85%)",
          opacity: activity === "idle" ? 0.14 : activity === "thinking" ? 0.18 : 0.24,
        }}
      />
      {/* Halo — glow ambiental intenso y difuso, se extiende MÁS ALLÁ del propio borde del avatar (inset negativo), no contenido adentro. Más intenso en listening/speaking. */}
      <span
        aria-hidden="true"
        className="absolute -inset-6 rounded-full blur-3xl transition-opacity duration-base sm:-inset-8"
        style={{
          background: "radial-gradient(circle, var(--color-accent), transparent 70%)",
          opacity: activity === "idle" ? 0.35 : activity === "thinking" ? 0.45 : 0.6,
        }}
      />
      {/* Segundo anillo, exterior al de base — más tenue, más grande, gira mucho más lento (kan-ring-outer, 70s) para dar profundidad. */}
      <span aria-hidden="true" className="kan-ring-outer absolute -inset-3 rounded-full opacity-70" />
      {/* Anillo de base — circunferencia continua */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{ border: "1.5px solid color-mix(in srgb, var(--color-accent) 20%, transparent)" }}
      />
      {/* Anillo angular exterior */}
      <span
        aria-hidden="true"
        className={`kan-ring absolute inset-0 rounded-full ${activity === "listening" ? "kan-ring-fast" : ""}`}
      />
      {/* Anillo interior invertido (HUD) */}
      <span
        aria-hidden="true"
        className="kan-ring-inner absolute inset-2 rounded-full opacity-60"
      />
      {/* Grilla HUD tipo mira — círculo concéntrico + cruz, muy sutil, puramente decorativo. */}
      <span
        aria-hidden="true"
        className="absolute inset-[20%] rounded-full opacity-30"
        style={{ border: "1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)" }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-[8%] opacity-25"
        style={{
          background: `
            linear-gradient(color-mix(in srgb, var(--color-accent) 45%, transparent) 1px, transparent 1px) 50% 0 / 100% 50% no-repeat,
            linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 45%, transparent) 1px, transparent 1px) 0 50% / 50% 100% no-repeat
          `,
        }}
      />
      {/* Núcleo — vidrio translúcido */}
      <span
        aria-hidden="true"
        className={`relative overflow-hidden flex items-center justify-center rounded-full backdrop-blur-md ${size === "lg" ? "h-[58%] w-[58%]" : "h-[54%] w-[54%]"} ${CORE_ANIMATION[activity]}`}
        style={{
          background: "color-mix(in srgb, var(--color-accent) 20%, transparent)",
          border: "1px solid color-mix(in srgb, var(--color-accent) 60%, transparent)",
          boxShadow: "var(--glow-accent)",
        }}
      >
        <span className="hud-scanline" />
        <span
          className={`font-mono font-bold tracking-[0.2em] text-ink z-10 ${size === "lg" ? "text-lg sm:text-xl" : "text-[10px]"}`}
          style={{ textShadow: "0 0 10px var(--color-accent)" }}
        >
          KAN
        </span>
      </span>
    </div>
  );
}

const ACTIVITY_LABEL: Record<KANActivity, string> = {
  idle: "en reposo",
  listening: "escuchando",
  thinking: "pensando",
  speaking: "hablando",
};
