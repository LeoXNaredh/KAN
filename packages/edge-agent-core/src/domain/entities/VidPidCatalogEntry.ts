/**
 * Catálogo VID/PID (ADR-060) — sin zod: no es dependencia de ningún paquete
 * de este monorepo (mismo criterio ya aplicado en `@kan/plugin-contract`
 * con `validateAgainstSchema`, hand-rolled en vez de traer una librería de
 * validación para un solo archivo JSON estático). Tipado + validado en
 * runtime igual, solo que sin la dependencia nueva.
 */
export interface VidPidCatalogEntry {
  /** Hex, con o sin prefijo "0x" (ej. "0x2341" o "2341") — se normaliza al comparar. */
  vendorId: string;
  productId: string;
  name: string;
}

function isVidPidCatalogEntry(value: unknown): value is VidPidCatalogEntry {
  const v = value as Partial<VidPidCatalogEntry> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.vendorId === "string" &&
    typeof v.productId === "string" &&
    typeof v.name === "string" &&
    v.name.trim().length > 0
  );
}

/** Filtra entradas inválidas en vez de tirar — un catálogo custom mal formado no debe tumbar el escaneo entero (mismo criterio best-effort del resto del repo). */
export function parseVidPidCatalog(raw: unknown): VidPidCatalogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isVidPidCatalogEntry);
}

export function normalizeHexId(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, "");
}

export function findInVidPidCatalog(
  catalog: VidPidCatalogEntry[],
  vendorId: string,
  productId: string,
): VidPidCatalogEntry | undefined {
  const v = normalizeHexId(vendorId);
  const p = normalizeHexId(productId);
  return catalog.find((entry) => normalizeHexId(entry.vendorId) === v && normalizeHexId(entry.productId) === p);
}
