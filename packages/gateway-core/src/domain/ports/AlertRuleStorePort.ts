import type { AlertRule } from "../entities/AlertRule";

/** Persistencia de la definición de las alertas (mismo criterio que ScheduledJobStorePort) — no de su sondeo, eso es AlertMonitor. */
export interface AlertRuleStorePort {
  load(): AlertRule[];
  save(rule: AlertRule): void;
  remove(ruleId: string): void;
}
