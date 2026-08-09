export interface DeviceResearchResult {
  summary: string;
  sources?: string[];
}

/**
 * Investiga un tipo de dispositivo (ADR-053) — especificaciones, pines,
 * protocolos, voltajes, casos de uso, advertencias de seguridad. `deviceKind`
 * es el tipo de plugin dueño del dispositivo (ej. "esp32-arduino"), no un
 * dispositivo físico individual — dos unidades del mismo tipo comparten la
 * misma investigación. `deviceNames` son los nombres reales que reportaron
 * los dispositivos de ese tipo (puede dar más contexto que el `kind` solo).
 * `undefined` si no encontró nada útil — nunca inventa specs de algo que no
 * pudo identificar.
 */
export interface DeviceResearchPort {
  research(deviceKind: string, deviceNames: string[]): Promise<DeviceResearchResult | undefined>;
}
