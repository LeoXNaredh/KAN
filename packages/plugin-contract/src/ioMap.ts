export type IoEntryType = "digital" | "analog" | "register" | "node";
export type IoEntryMode = "input" | "output" | "unknown";

/**
 * Un elemento del mapa de IO devuelto por la capability compartida
 * `discover_io_map` (docs/00-analisis-y-decisiones.md, ADR-058). A
 * diferencia de `TargetDescriptor` (clasificación de Safety Policy, sync,
 * sin I/O), esto es estado en vivo — value puede requerir una lectura real
 * del dispositivo.
 */
export interface IoMapEntry {
  target: string;
  type: IoEntryType;
  mode: IoEntryMode;
  value: boolean | number | null;
  label?: string;
}
