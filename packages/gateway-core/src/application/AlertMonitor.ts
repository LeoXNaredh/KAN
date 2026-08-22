import { randomUUID } from "node:crypto";
import type { LoggerPort } from "@kan/plugin-contract";
import type { AlertRule } from "../domain/entities/AlertRule";
import type { AlertRuleStorePort } from "../domain/ports/AlertRuleStorePort";
import type { TaskResult } from "../domain/entities/GatewayTask";
import { ConsoleLogger } from "../infra/ConsoleLogger";

/** Cómo AlertMonitor lee el valor actual de una capability — Gateway pasa `(ref, input) => this.taskOrchestrator.submit({capabilityRef: ref, input})`, nunca depende del tipo concreto de TaskOrchestrator acá. */
export type CapabilityReader = (capabilityRef: string, input: unknown) => Promise<TaskResult>;

/** Se llama solo en la transición "normal" -> "cruzada" (ver AlertMonitor). */
export type AlertDispatch = (rule: AlertRule, value: number) => Promise<void>;

const DEFAULT_POLL_INTERVAL_MS = 30_000;
/** Tope de alertas activas por usuario (por `createdBy`) — sin esto, cada regla nueva es un poll más cada `pollIntervalMs` contra el TaskOrchestrator, sin ningún límite. */
const MAX_ALERTS_PER_USER = 20;

function extractNumericValue(data: unknown, field?: string): number | undefined {
  let current: unknown = data;
  if (field) {
    for (const part of field.split(".")) {
      if (typeof current !== "object" || current === null) return undefined;
      current = (current as Record<string, unknown>)[part];
    }
  }
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

function validateAlertInput(input: Omit<AlertRule, "id" | "createdAt">): void {
  if (!input.capabilityRef || !input.capabilityRef.trim()) {
    throw new Error("Una alerta necesita un 'capabilityRef' no vacío.");
  }
  if (input.comparator !== "above" && input.comparator !== "below") {
    throw new Error("El comparador de una alerta debe ser 'above' o 'below'.");
  }
  if (typeof input.threshold !== "number" || !Number.isFinite(input.threshold)) {
    throw new Error("Una alerta necesita un 'threshold' numérico.");
  }
  if (!input.label || !input.label.trim()) {
    throw new Error("Una alerta necesita un 'label' no vacío (ej. 'la temperatura').");
  }
}

/**
 * Sistema básico de alertas (requisito: "avisame si la temperatura supera 40
 * grados") — sondea cada regla activa a intervalo fijo invocando su
 * `capabilityRef` (una capability de lectura ya disponible) vía `reader`,
 * mismo mecanismo que usa un paso de automatización (TaskOrchestrator.submit),
 * sin acoplarse a su tipo concreto acá.
 *
 * Edge-triggered a propósito: una regla ya cruzada no vuelve a disparar
 * `dispatch` en cada poll mientras el valor siga del lado "cruzado" — evita
 * bombardear con el mismo aviso cada 30s mientras la temperatura sigue alta.
 * Vuelve a poder avisar recién cuando el valor cae de nuevo dentro de rango y
 * cruza otra vez.
 */
export class AlertMonitor {
  private readonly rules = new Map<string, AlertRule>();
  private readonly triggered = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private dispatch?: AlertDispatch;

  constructor(
    private readonly reader: CapabilityReader,
    private readonly store?: AlertRuleStorePort,
    private readonly logger: LoggerPort = new ConsoleLogger(),
    private readonly pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {
    for (const rule of this.store?.load() ?? []) this.rules.set(rule.id, rule);
  }

  create(input: Omit<AlertRule, "id" | "createdAt">): AlertRule {
    validateAlertInput(input);
    this.assertUnderLimit(input.createdBy);
    const rule: AlertRule = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.rules.set(rule.id, rule);
    this.store?.save(rule);
    return rule;
  }

  /**
   * Cuenta por `createdBy` exacto — incluye `undefined` como su propio
   * "usuario" (alertas creadas sin sesión comparten ese cupo entre sí, mismo
   * criterio que el resto del archivo: nunca las trata como ilimitadas).
   */
  private assertUnderLimit(createdBy: string | undefined): void {
    const count = Array.from(this.rules.values()).filter((rule) => rule.createdBy === createdBy).length;
    if (count >= MAX_ALERTS_PER_USER) {
      throw new Error(`Ya tenés ${MAX_ALERTS_PER_USER} alertas activas. Cancelá alguna antes de crear una nueva.`);
    }
  }

  /**
   * Re-inserta una regla ya existente tal cual (id/createdAt originales) —
   * a diferencia de `create()`, no genera un id nuevo ni cuenta contra
   * `MAX_ALERTS_PER_USER` (docs/06, restore de snapshot de configuración de
   * PLC/Modbus/OPC-UA): restaurar un backup propio es un upsert explícito
   * del usuario sobre lo que YA tenía, no la creación de algo nuevo. Nunca
   * borra reglas que no estén en el snapshot — solo trae de vuelta las que sí.
   */
  restore(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    this.store?.save(rule);
  }

  cancel(ruleId: string): void {
    if (!this.rules.has(ruleId)) return;
    this.rules.delete(ruleId);
    this.triggered.delete(ruleId);
    this.store?.remove(ruleId);
  }

  list(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /** Empieza a sondear. Antes de llamar esto, ninguna regla se chequea (mismo criterio que SchedulerPort.start()). */
  start(dispatch: AlertDispatch): void {
    this.dispatch = dispatch;
    this.timer = setInterval(() => void this.pollAll(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.dispatch = undefined;
  }

  /**
   * En paralelo (Promise.allSettled), no secuencial — una regla lenta (ej.
   * un dispositivo desconectado, esperando el timeout de 40s de
   * TaskOrchestrator) no debe demorar el chequeo de las demás reglas de este
   * mismo tick. `allSettled` (no `all`) porque el rechazo de una no debe
   * cortar el sondeo de las otras.
   */
  private async pollAll(): Promise<void> {
    const rules = Array.from(this.rules.values());
    const results = await Promise.allSettled(rules.map((rule) => this.pollRule(rule)));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const rule = rules[index];
        this.logger.warn(`[AlertMonitor] fallo al sondear la alerta ${rule.id} (${rule.capabilityRef}): ${result.reason}`);
      }
    });
  }

  private async pollRule(rule: AlertRule): Promise<void> {
    const result = await this.reader(rule.capabilityRef, {});
    // Capability inexistente/desconectada/pendiente de confirmación: se
    // reintenta en el próximo poll, nunca revienta el ciclo por una regla.
    if (result.status !== "done") return;

    const value = extractNumericValue(result.data, rule.field);
    if (value === undefined) return;

    const crossed = rule.comparator === "above" ? value > rule.threshold : value < rule.threshold;
    const wasTriggered = this.triggered.has(rule.id);

    if (crossed && !wasTriggered) {
      this.triggered.add(rule.id);
      await this.dispatch?.(rule, value);
    } else if (!crossed && wasTriggered) {
      this.triggered.delete(rule.id);
    }
  }
}
