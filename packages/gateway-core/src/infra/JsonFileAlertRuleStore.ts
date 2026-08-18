import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AlertRule } from "../domain/entities/AlertRule";
import type { AlertRuleStorePort } from "../domain/ports/AlertRuleStorePort";

/** Mismo patrón que JsonFileScheduledJobStore: un único archivo JSON, reescritura completa en cada mutación. */
export class JsonFileAlertRuleStore implements AlertRuleStorePort {
  private rules: Record<string, AlertRule>;

  constructor(private readonly filePath: string) {
    this.rules = this.readFromDisk();
  }

  load(): AlertRule[] {
    return Object.values(this.rules);
  }

  save(rule: AlertRule): void {
    this.rules[rule.id] = rule;
    this.persist();
  }

  remove(ruleId: string): void {
    delete this.rules[ruleId];
    this.persist();
  }

  private readFromDisk(): Record<string, AlertRule> {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.rules, null, 2), "utf-8");
  }
}
