import type { TelemetryReadingView } from "@/lib/sensores/types";

const WIDTH = 480;
const HEIGHT = 160;
const PADDING = 24;

/**
 * Gráfico de línea nativo (SVG, sin librería — recharts no está instalado
 * en el proyecto y el pedido explícito es no agregarlo solo para esto).
 * Eje X = tiempo, eje Y = valor; escala min/max calculada de las lecturas
 * recibidas (hasta 200 del historial del Gateway, "mínimo 50" se cumple con
 * margen).
 */
export function SensorChart({ readings }: { readings: TelemetryReadingView[] }) {
  if (readings.length < 2) {
    return <p className="text-sm text-ink-faint">Todavía no hay suficientes lecturas para graficar.</p>;
  }

  const values = readings.map((r) => r.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const plotWidth = WIDTH - PADDING * 2;
  const plotHeight = HEIGHT - PADDING * 2;

  const points = readings
    .map((reading, index) => {
      const x = PADDING + (index / (readings.length - 1)) * plotWidth;
      const y = PADDING + plotHeight - ((reading.value - min) / range) * plotHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const first = readings[0];
  const last = readings[readings.length - 1];

  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Gráfico de los valores recientes de este sensor">
        <line x1={PADDING} y1={PADDING} x2={PADDING} y2={HEIGHT - PADDING} stroke="var(--color-line)" strokeWidth="1" />
        <line x1={PADDING} y1={HEIGHT - PADDING} x2={WIDTH - PADDING} y2={HEIGHT - PADDING} stroke="var(--color-line)" strokeWidth="1" />
        <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <text x={PADDING} y={PADDING - 8} fontSize="10" fill="var(--color-ink-faint)">
          {max.toFixed(1)}
        </text>
        <text x={PADDING} y={HEIGHT - PADDING + 14} fontSize="10" fill="var(--color-ink-faint)">
          {min.toFixed(1)}
        </text>
      </svg>
      <div className="flex justify-between text-xs text-ink-faint">
        <span>{new Date(first.at).toLocaleTimeString()}</span>
        <span>{new Date(last.at).toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
