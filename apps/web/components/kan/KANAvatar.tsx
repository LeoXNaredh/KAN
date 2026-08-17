import type { KANActivity } from "@/lib/kan/useKANState";

const CORE_ANIMATION: Record<KANActivity, string> = {
  idle: "kan-core-idle",
  listening: "kan-core-listening",
  thinking: "kan-core-thinking",
  speaking: "kan-core-speaking",
};

const SIZE_CLASSES = {
  lg: "h-[220px] w-[220px]",
  sm: "h-16 w-16 sm:h-20 sm:w-20",
} as const;

// Reacciones del grupo de anillos por `activity` — dos mecanismos por
// separado para no pisar la rotación propia de cada anillo (`animation`
// shorthand): la velocidad se aplica al anillo angular (`.kan-ring`) como
// override de `animation-duration`, y el pulso/blur se aplica al `<span>`
// contenedor (transform/filter componen con la rotación de los hijos sin
// chocar). Sin datos reales de amplitud de voz — ver comentario en
// globals.css.
const RING_SPEED_CLASS: Record<KANActivity, string> = {
  idle: "",
  listening: "kan-ring-fast",
  thinking: "",
  speaking: "kan-ring-speaking",
};

const RING_GROUP_CLASS: Record<KANActivity, string> = {
  idle: "",
  listening: "kan-rings-listening",
  thinking: "kan-rings-thinking",
  speaking: "",
};

/**
 * Núcleo animado de KAN — el elemento central de la identidad visual
 * (rediseño eDEX-UI sobre la base Kukulkán/JARVIS): 3 anillos concéntricos
 * girando a velocidades distintas (exterior tenue 70s, angular 40s, HUD
 * invertido 26s reverse — sin SVG ni librería, `.kan-ring*` en globals.css)
 * que reaccionan por `activity` (más rápido al hablar, pulso al escuchar,
 * blur hipnótico al pensar), alrededor de una grilla HUD tipo mira/radar, un
 * halo + nebulosa que se difuminan bien hacia afuera del borde del avatar, y
 * un núcleo de vidrio (translúcido + blur) con una capa de "plasma" (gradiente
 * de acento en movimiento) detrás de "KAN", legible en el centro.
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
      {/* Grupo de 3 anillos girando a velocidades distintas (exterior/angular/HUD) — wrapper propio para que el pulso de listening / blur de thinking no choquen con la rotación individual de cada uno. */}
      <span aria-hidden="true" className={`absolute inset-0 ${RING_GROUP_CLASS[activity]}`}>
        {/* Anillo exterior, más tenue, más lento (kan-ring-outer, 70s) — da profundidad. */}
        <span className="kan-ring-outer absolute -inset-3 rounded-full opacity-70" />
        {/* Anillo de base — circunferencia continua */}
        <span
          className="absolute inset-0 rounded-full"
          style={{ border: "1.5px solid color-mix(in srgb, var(--color-accent) 20%, transparent)" }}
        />
        {/* Anillo angular */}
        <span className={`kan-ring absolute inset-0 rounded-full ${RING_SPEED_CLASS[activity]}`} />
        {/* Anillo interior invertido (HUD) */}
        <span className="kan-ring-inner absolute inset-2 rounded-full opacity-60" />
      </span>
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
      {/* Núcleo — vidrio translúcido con una capa de "plasma" (gradiente de acento en movimiento) por detrás; glitch muy sutil cuando habla. */}
      <span
        aria-hidden="true"
        className={`relative overflow-hidden flex items-center justify-center rounded-full backdrop-blur-md ${size === "lg" ? "h-[58%] w-[58%]" : "h-[54%] w-[54%]"} ${CORE_ANIMATION[activity]} ${activity === "speaking" ? "kan-avatar-glitch" : ""}`}
        style={{
          background: "color-mix(in srgb, var(--color-accent) 20%, transparent)",
          border: "1px solid color-mix(in srgb, var(--color-accent) 60%, transparent)",
          boxShadow: "var(--glow-accent)",
        }}
      >
        <span className="kan-core-plasma" style={{ opacity: 0.4 }} />
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
