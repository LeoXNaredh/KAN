import type { KANActivity } from "@/lib/kan/useKANState";

const CORE_ANIMATION: Record<KANActivity, string> = {
  idle: "kan-core-idle",
  listening: "kan-core-listening",
  thinking: "kan-core-thinking",
  speaking: "kan-core-speaking",
};

const SIZE_CLASSES = {
  lg: "h-[120px] w-[120px]",
  sm: "h-16 w-16",
} as const;

const GLOW_OPACITY: Record<KANActivity, number> = {
  idle: 0.35,
  listening: 0.55,
  thinking: 0.4,
  speaking: 0.55,
};

/**
 * Avatar de KAN (rediseño inspirado en Gemini) — un círculo limpio con un
 * glow suave detrás, sin anillos ni segmentos: la versión anterior (HUD/
 * eDEX-UI, 3 anillos SVG + grilla + "plasma") quedó reemplazada por algo
 * mucho más cercano al logomark de Gemini — forma simple, un solo color con
 * gradiente, sin ornamento adentro. "KAN" ya no va escrito dentro del
 * círculo — va como label debajo, texto normal (no mono), separado del
 * círculo (`showLabel`, apagado en el avatar-esquina achicado de
 * `KANLayout` en fase "working": a esa escala un label de texto se ve
 * amontonado, no legible).
 *
 * `activity` sigue moviendo el mismo glow/pulso que antes (`.kan-core-*`,
 * globals.css) — solo se le sacó la ornamentación, no la reactividad.
 */
export function KANAvatar({
  size = "lg",
  activity = "idle",
  className = "",
  showLabel = true,
}: {
  size?: "lg" | "sm";
  activity?: KANActivity;
  className?: string;
  showLabel?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <div
        role="img"
        aria-label={`KAN — ${ACTIVITY_LABEL[activity]}`}
        className={`relative flex shrink-0 items-center justify-center ${SIZE_CLASSES[size]}`}
      >
        {/* Glow suave detrás del círculo — una sola capa, sin halos/nebulosa apiladas. */}
        <span
          aria-hidden="true"
          className="absolute -inset-6 rounded-full blur-2xl transition-opacity duration-base"
          style={{
            background: "radial-gradient(circle, var(--color-accent), transparent 70%)",
            opacity: GLOW_OPACITY[activity],
          }}
        />
        {/* Círculo — gradiente sólido del acento, sin vidrio ni texto adentro. */}
        <span
          aria-hidden="true"
          className={`h-full w-full rounded-full ${CORE_ANIMATION[activity]}`}
          style={{
            background: "var(--gradient-accent)",
            boxShadow: "var(--glow-accent)",
          }}
        />
      </div>
      {showLabel && <span className="text-sm font-medium tracking-wide text-ink-muted">KAN</span>}
    </div>
  );
}

const ACTIVITY_LABEL: Record<KANActivity, string> = {
  idle: "en reposo",
  listening: "escuchando",
  thinking: "pensando",
  speaking: "hablando",
};
