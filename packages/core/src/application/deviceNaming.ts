/**
 * Convención de memoria para nombres personalizados de dispositivos
 * (categoría "dispositivos", ver MEMORY_CATEGORIES) — la clave es el prefijo
 * fijo más el nombre técnico exacto tal como lo reporta el Edge Agent, sin
 * normalizar/slugificar: así el system prompt puede instruirle al LLM una
 * regla de concatenación literal, sin depender de que reproduzca un
 * algoritmo de normalización de forma consistente entre turnos.
 *
 * Distinta de la clave que ya usa DeviceEnrichmentService (apps/gateway,
 * ADR-053) para investigación automática por tipo de dispositivo — esa usa
 * `deviceKind` (ej. "esp32") como clave, sin prefijo, así que no colisiona
 * con esta (nombre de una unidad física puntual, ej. "HC-02").
 */
export const DEVICE_DISPLAY_NAME_KEY_PREFIX = "nombre_";

export function deviceDisplayNameMemoryKey(rawDeviceName: string): string {
  return `${DEVICE_DISPLAY_NAME_KEY_PREFIX}${rawDeviceName}`;
}
