export type AuditActor = "llm" | "user" | "system";

export interface AuditEntry {
  id: string;
  at: string;
  actor: AuditActor;
  action: string;
  subject: string;
  metadata: Record<string, unknown>;
  /**
   * Usuario real detrás de esta entrada (docs/19 P2, incremento 5) —
   * `actor` sigue siendo la clasificación de rol; esto es la identidad
   * concreta cuando se conoce (verificada por JWT, o el owner del Edge
   * Agent involucrado). Ausente en jobs sin dueño resoluble y en
   * entradas de antes de este incremento.
   */
  userId?: string;
}
