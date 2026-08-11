import { requiresConfirmation, type ActionSeverity } from "@kan/plugin-contract";
import type { PendingConfirmation } from "../domain/entities/PendingConfirmation";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { EdgeAgentBus } from "./EdgeAgentBus";

export type PermissionDecision =
  | { outcome: "approved" }
  | { outcome: "pending"; confirmation: PendingConfirmation };

/** Una confirmación ignorada indefinidamente se trata como rechazada, no queda huérfana para siempre (hallazgo M6 de docs/13). */
const CONFIRMATION_TTL_MS = 10 * 60_000;

/**
 * Aplica ADR-004 (docs/00): `read-only`/`reversible` se aprueban directo;
 * `irreversible-material`/`safety-critical` quedan pendientes hasta
 * confirmación explícita del usuario. Esta es la única puerta por la que
 * pasa cualquier invocación de capability (ver CapabilityRegistry).
 */
export class PermissionManager {
  private readonly pending = new Map<string, PendingConfirmation>();
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly bus: EdgeAgentBus,
    private readonly logger: LoggerPort,
  ) {}

  evaluate(deviceId: string, capabilityName: string, severity: ActionSeverity, input: unknown): PermissionDecision {
    if (!requiresConfirmation(severity)) {
      return { outcome: "approved" };
    }

    const confirmation: PendingConfirmation = {
      id: globalThis.crypto.randomUUID(),
      deviceId,
      capabilityName,
      input,
      severity,
      requestedAt: new Date().toISOString(),
    };
    this.pending.set(confirmation.id, confirmation);
    this.expiryTimers.set(
      confirmation.id,
      setTimeout(() => {
        if (!this.pending.has(confirmation.id)) return;
        this.logger.warn(`Confirmación expirada sin respuesta, tratada como rechazo: ${confirmation.id}`);
        this.resolve(confirmation.id, false);
      }, CONFIRMATION_TTL_MS),
    );
    this.logger.warn(`Confirmación requerida: ${capabilityName} en ${deviceId} (${severity})`);
    this.bus.emit("permission.pending", { confirmation });
    return { outcome: "pending", confirmation };
  }

  resolve(confirmationId: string, approved: boolean): PendingConfirmation | undefined {
    const confirmation = this.pending.get(confirmationId);
    if (!confirmation) return undefined;
    this.pending.delete(confirmationId);
    const timer = this.expiryTimers.get(confirmationId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(confirmationId);
    }
    this.bus.emit("permission.resolved", { confirmationId, approved });
    return confirmation;
  }

  listPending(): PendingConfirmation[] {
    return Array.from(this.pending.values());
  }
}
