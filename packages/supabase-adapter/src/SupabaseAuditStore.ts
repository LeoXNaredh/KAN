import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEntry, AuditStorePort } from "@kan/gateway-core";

/**
 * `JsonlAuditStore.list()` devolvía literalmente todo el historial en
 * memoria — una tabla de Postgres puede crecer sin ese límite natural, y el
 * único consumidor real (`apps/web`'s `/api/status`, `RECENT_ACTIVITY_LIMIT
 * = 10`) ya trunca y reordena del lado del cliente, así que un tope
 * defensivo de las 500 filas más recientes no cambia ningún comportamiento
 * visible (docs/16 P3, ADR-026).
 */
const MAX_ROWS = 500;

/**
 * Adaptador Supabase de `AuditStorePort` (@kan/gateway-core), docs/16 P3 /
 * ADR-026. A diferencia del resto de `@kan/supabase-adapter` (que escriben
 * con la `anon key` + sesión del usuario), este recibe un cliente construido
 * con la `service_role key` — el Gateway no tiene sesión de usuario
 * (no hay `auth.uid()`), y `audit_entries` tiene RLS activado sin ninguna
 * policy para anon/authenticated a propósito.
 */
interface AuditRow {
  id: string;
  at: string;
  actor: AuditEntry["actor"];
  action: string;
  subject: string;
  metadata: Record<string, unknown>;
  user_id: string | null;
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    at: row.at,
    actor: row.actor,
    action: row.action,
    subject: row.subject,
    metadata: row.metadata,
    userId: row.user_id ?? undefined,
  };
}

export class SupabaseAuditStore implements AuditStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async append(entry: AuditEntry): Promise<void> {
    const { error } = await this.client.from("audit_entries").insert({
      id: entry.id,
      at: entry.at,
      actor: entry.actor,
      action: entry.action,
      subject: entry.subject,
      metadata: entry.metadata,
      user_id: entry.userId,
    });
    // Best-effort, igual que JsonlAuditStore: un fallo al persistir la
    // auditoría nunca debe romper el flujo que la disparó (AuditService.record()
    // no espera esta promesa).
    if (error) console.error(`[SupabaseAuditStore] no se pudo escribir: ${error.message}`);
  }

  async list(filter?: Partial<Pick<AuditEntry, "actor" | "action" | "subject" | "userId">>): Promise<AuditEntry[]> {
    let query = this.client.from("audit_entries").select("*").order("at", { ascending: false }).limit(MAX_ROWS);
    if (filter?.actor) query = query.eq("actor", filter.actor);
    if (filter?.action) query = query.eq("action", filter.action);
    if (filter?.subject) query = query.eq("subject", filter.subject);
    // `.or()`, no `.eq()` (ADR-037): entradas de sistema sin dueño único
    // (`job.fired`/`job.notification`, ver ADR-033 — "no hay un único valor
    // correcto") tienen `user_id null` a propósito. Un `.eq("user_id", ...)`
    // estricto las dejaba invisibles para cualquier usuario, siempre — este
    // filtro deja ver las propias MÁS las de sistema, sin exponer las de
    // otros usuarios. `filter.userId` siempre es el `sub` de un JWT ya
    // verificado (nunca texto libre de un request), seguro de interpolar acá.
    if (filter?.userId) query = query.or(`user_id.eq.${filter.userId},user_id.is.null`);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return ((data ?? []) as AuditRow[]).map(toAuditEntry);
  }
}
