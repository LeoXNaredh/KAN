import { existsSync, readFileSync } from "node:fs";
import baseCatalog from "../data/vid-pid-catalog.json" with { type: "json" };
import { parseVidPidCatalog, normalizeHexId, type VidPidCatalogEntry } from "../domain/entities/VidPidCatalogEntry";

/**
 * Catálogo base + custom del usuario, mergeados (ADR-060) — así un cliente
 * industrial agrega su PLC/adaptador propio sin fork del repo. `customPath`
 * lo resuelve quien compone el Edge Agent (`apps/desktop`, mismo criterio
 * que `JsonFileConfigStore`: este paquete no asume `userData`/`homedir`,
 * los recibe ya resueltos) — sin `customPath`, o si el archivo no existe,
 * devuelve solo el catálogo base. Un catálogo custom corrupto no tira
 * abajo el escaneo (mismo criterio best-effort del resto del repo): se
 * ignora y se sigue con el base.
 */
export function loadVidPidCatalog(customPath?: string): VidPidCatalogEntry[] {
  const base = parseVidPidCatalog(baseCatalog);
  if (!customPath || !existsSync(customPath)) return base;

  try {
    const custom = parseVidPidCatalog(JSON.parse(readFileSync(customPath, "utf8")));
    const merged = new Map(base.map((entry) => [catalogKey(entry), entry]));
    for (const entry of custom) merged.set(catalogKey(entry), entry);
    return Array.from(merged.values());
  } catch {
    return base;
  }
}

function catalogKey(entry: VidPidCatalogEntry): string {
  return `${normalizeHexId(entry.vendorId)}:${normalizeHexId(entry.productId)}`;
}
