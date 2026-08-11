import type { KANActivity } from "@/lib/kan/useKANState";

const CORE_ANIMATION: Record<KANActivity, string> = {
  idle: "kan-core-idle",
  listening: "kan-core-listening",
  thinking: "kan-core-thinking",
  speaking: "kan-core-speaking",
};

const SIZE_CLASSES = {
  lg: "h-40 w-40 sm:h-48 sm:w-48",
  sm: "h-16 w-16 sm:h-20 sm:w-20",
} as const;

/**
 * Núcleo animado de KAN — el elemento central de la identidad visual
 * (rediseño Kukulkán): un anillo angular segmentado girando (geometría
 * maya, sin SVG ni librería — `.kan-ring` en globals.css) alrededor de una
 * grilla HUD tipo mira/radar, un halo difuso y un núcleo de vidrio
 * (translúcido + blur, no un disco sólido — "etéreo", no "sólido")
 * reaccionando a `activity`. Puramente presentacional: quién orquesta
 * tamaño/posición (centro vs. esquina) es `KANLayout`, no este componente
 * — así el mismo avatar sirve para el catálogo de `/design-system` sin
 * arrastrar layout.
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
      {/* Anillo angular exterior — segmentos con gaps amplios (referencia JARVIS, no un borde continuo). Más rápido mientras escucha. */}
      <span
        aria-hidden="true"
        className={`kan-ring absolute inset-0 rounded-full ${activity === "listening" ? "kan-ring-fast" : ""}`}
      />
      {/* Grilla HUD tipo mira — dos círculos concéntricos finos + cruz, muy sutil, puramente decorativo. */}
      <span
        aria-hidden="true"
        className="absolute inset-[8%] rounded-full opacity-40"
        style={{
          border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
        }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-[20%] rounded-full opacity-30"
        style={{
          border: "1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)",
        }}
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
      {/* Halo — glow ambiental difuso (no un círculo sólido), más intenso en listening/speaking. */}
      <span
        aria-hidden="true"
        className="absolute inset-[10%] rounded-full blur-2xl transition-opacity duration-base"
        style={{
          background: "radial-gradient(circle, var(--color-accent), transparent 70%)",
          opacity: activity === "idle" ? 0.25 : activity === "thinking" ? 0.32 : 0.42,
        }}
      />
      {/* Núcleo — vidrio translúcido, no un disco sólido: fill semi-transparente + blur + borde fino, la parte que respira. */}
      <span
        aria-hidden="true"
        className={`relative rounded-full backdrop-blur-md ${size === "lg" ? "h-[56%] w-[56%]" : "h-[52%] w-[52%]"} ${CORE_ANIMATION[activity]}`}
        style={{
          background: "color-mix(in srgb, var(--color-accent) 38%, transparent)",
          border: "1px solid color-mix(in srgb, var(--color-accent) 70%, transparent)",
          boxShadow: "var(--glow-accent)",
        }}
      />
    </div>
  );
}

const ACTIVITY_LABEL: Record<KANActivity, string> = {
  idle: "en reposo",
  listening: "escuchando",
  thinking: "pensando",
  speaking: "hablando",
};
