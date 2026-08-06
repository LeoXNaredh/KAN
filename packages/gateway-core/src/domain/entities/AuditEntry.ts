export type AuditActor = "llm" | "user" | "system";

export interface AuditEntry {
  id: string;
  at: string;
  actor: AuditActor;
  action: string;
  subject: string;
  metadata: Record<string, unknown>;
}
