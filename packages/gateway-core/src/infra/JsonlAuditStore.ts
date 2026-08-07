import { appendFile, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditEntry } from "../domain/entities/AuditEntry";
import type { AuditStorePort } from "../domain/ports/AuditStorePort";

/**
 * Un registro por línea, append-only, durable entre reinicios (docs/12 §6).
 * El archivo se lee una sola vez al arrancar (no en cada `list()` — hallazgo
 * M9 de docs/13) y las escrituras son asíncronas y no bloqueantes (hallazgo
 * A8: `appendFileSync` en el hot path bloqueaba el único hilo del Gateway
 * en cada ejecución de tool). El array en memoria es la fuente de lectura;
 * el archivo es la copia durable para sobrevivir un reinicio.
 *
 * Sigue disponible como alternativa sin dependencias externas tras ADR-026
 * (docs/16 P3) — `apps/gateway` en producción usa `SupabaseAuditStore`
 * (`@kan/supabase-adapter`) en su lugar, mismo criterio que
 * `InMemoryConversationRepository` sigue existiendo tras ADR-007.
 */
export class JsonlAuditStore implements AuditStorePort {
  private readonly entries: AuditEntry[] = [];

  constructor(private readonly filePath: string) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.entries = this.loadFromDisk();
  }

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf-8", (error) => {
      if (error) console.error(`[JsonlAuditStore] no se pudo escribir a disco: ${error.message}`);
    });
  }

  async list(filter?: Partial<Pick<AuditEntry, "actor" | "action" | "subject">>): Promise<AuditEntry[]> {
    if (!filter) return [...this.entries];
    return this.entries.filter(
      (entry) =>
        (!filter.actor || entry.actor === filter.actor) &&
        (!filter.action || entry.action === filter.action) &&
        (!filter.subject || entry.subject === filter.subject),
    );
  }

  private loadFromDisk(): AuditEntry[] {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as AuditEntry;
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is AuditEntry => entry !== undefined);
  }
}
