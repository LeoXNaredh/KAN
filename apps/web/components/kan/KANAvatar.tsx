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
 * (rediseño Kukulkán): un anillo angular girando (geometría maya, sin SVG
 * ni librería — `.kan-ring` en globals.css) alrededor de un núcleo con
 * glow que respira o reacciona según `activity`. Puramente presentacional:
 * quién orquesta tamaño/posición (centro vs. esquina) es `KANLayout`, no
 * este componente — así el mismo avatar sirve para el catálogo de
 * `/design-system` sin arrastrar layout.
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
      {/* Anillo angular exterior — más rápido mientras escucha, quieto/lento en reposo. */}
      <span
        aria-hidden="true"
        className={`kan-ring absolute inset-0 rounded-full ${activity === "listening" ? "kan-ring-fast" : ""}`}
      />
      {/* Halo — glow ambiental, más intenso en listening/speaking. */}
      <span
        aria-hidden="true"
        className="absolute inset-[12%] rounded-full blur-xl transition-opacity duration-base"
        style={{
          background: "var(--color-accent)",
          opacity: activity === "idle" ? 0.35 : activity === "thinking" ? 0.45 : 0.6,
        }}
      />
      {/* Núcleo — círculo sólido con el gradiente de marca, la parte que realmente "respira". */}
      <span
        aria-hidden="true"
        className={`bg-gradient-accent relative rounded-full ${size === "lg" ? "h-[62%] w-[62%]" : "h-[58%] w-[58%]"} ${CORE_ANIMATION[activity]}`}
        style={{ boxShadow: "var(--glow-accent)" }}
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
