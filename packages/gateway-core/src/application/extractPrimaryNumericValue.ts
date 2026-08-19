/**
 * Extrae "el número que representa esta lectura" de un `CapabilityResult.data`
 * — mismo espíritu que `extractNumericValue` de `AlertMonitor.ts`, pero sin
 * requerir un `field` configurado de antemano (una `AlertRule` lo tiene
 * porque el usuario lo tipeó al crearla; una lectura genérica de telemetría
 * no tiene ese contexto). Si `data` ya es un número, se usa tal cual. Si es
 * un objeto con EXACTAMENTE un campo numérico, se usa ese campo — el caso
 * común de capabilities tipo `{ temperatureC: 23.4 }`. Cualquier otro shape
 * (varios campos numéricos, ninguno, no numérico) devuelve `undefined`: esa
 * capability no es graficable como un único valor, y no se inventa cuál
 * campo mostrar.
 */
export function extractPrimaryNumericValue(data: unknown): number | undefined {
  if (typeof data === "number" && Number.isFinite(data)) return data;
  if (data && typeof data === "object") {
    const numericValues = Object.values(data as Record<string, unknown>).filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    if (numericValues.length === 1) return numericValues[0];
  }
  return undefined;
}
