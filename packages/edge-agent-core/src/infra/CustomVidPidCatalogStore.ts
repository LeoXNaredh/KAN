import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseVidPidCatalog, normalizeHexId, type VidPidCatalogEntry } from "../domain/entities/VidPidCatalogEntry";

export interface AddVidPidCatalogEntryInput {
  name: string;
  vendorId: string;
  productId: string;
}

// Hasta 4 dígitos hex, con o sin "0x" — un VID/PID real de USB siempre entra
// en 16 bits (ver vid-pid-catalog.json, todos los valores base son de 4
// dígitos). No exige el prefijo "0x" (el usuario puede tipear "1234" o
// "0x1234", el Administrador de dispositivos de Windows los muestra sin él).
const HEX_ID_PATTERN = /^(0x)?[0-9a-f]{1,4}$/i;

function isValidHexId(value: string): boolean {
  return HEX_ID_PATTERN.test(value.trim());
}

/**
 * Catálogo VID/PID custom del usuario, con escritura (requisito: UI para
 * agregar dispositivos sin editar `vid-pid-custom.json` a mano) — mismo
 * archivo que ya lee `loadVidPidCatalog()` (ADR-060) y mismo patrón de
 * archivo JSON local que `JsonFileConfigStore`/`JsonFileDeviceStore`.
 * Guarda SOLO las entradas custom, nunca el catálogo base
 * (`data/vid-pid-catalog.json`, embebido en el build, de solo lectura) —
 * `loadVidPidCatalog()` sigue siendo quien mergea ambos al escanear; quien
 * compone el Edge Agent (`apps/desktop`) es responsable de volver a
 * llamarlo después de `add()`/`remove()` para que el escaneo en curso vea
 * el cambio (ver `refreshVidPidCatalog()` en `apps/desktop/src/main/index.ts`).
 */
export class CustomVidPidCatalogStore {
  constructor(private readonly filePath: string) {}

  list(): VidPidCatalogEntry[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return parseVidPidCatalog(JSON.parse(readFileSync(this.filePath, "utf-8")));
    } catch {
      return [];
    }
  }

  /** Lanza (mensaje en lenguaje simple, para mostrar tal cual en la UI) si el nombre está vacío, el VID/PID no es hexadecimal válido, o ya existe una entrada con ese mismo VID/PID. */
  add(input: AddVidPidCatalogEntryInput): VidPidCatalogEntry {
    const name = input.name.trim();
    const vendorId = input.vendorId.trim();
    const productId = input.productId.trim();

    if (!name) throw new Error("El dispositivo necesita un nombre.");
    if (!isValidHexId(vendorId)) throw new Error(`El VID "${vendorId}" no es válido — tiene que ser un número hexadecimal (ej. 0x1234).`);
    if (!isValidHexId(productId)) throw new Error(`El PID "${productId}" no es válido — tiene que ser un número hexadecimal (ej. 0x5678).`);

    const entries = this.list();
    const alreadyExists = entries.some(
      (entry) => normalizeHexId(entry.vendorId) === normalizeHexId(vendorId) && normalizeHexId(entry.productId) === normalizeHexId(productId),
    );
    if (alreadyExists) throw new Error(`Ya agregaste un dispositivo con VID ${vendorId} y PID ${productId}.`);

    const entry: VidPidCatalogEntry = { name, vendorId, productId };
    entries.push(entry);
    this.persist(entries);
    return entry;
  }

  /** No-op silencioso si no existía — mismo criterio best-effort que `AlertMonitor.cancel()`. */
  remove(vendorId: string, productId: string): void {
    const entries = this.list().filter(
      (entry) => !(normalizeHexId(entry.vendorId) === normalizeHexId(vendorId) && normalizeHexId(entry.productId) === normalizeHexId(productId)),
    );
    this.persist(entries);
  }

  private persist(entries: VidPidCatalogEntry[]): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(entries, null, 2), "utf-8");
  }
}
