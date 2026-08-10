import { validateAgainstSchema, type CapabilityDescriptor, type CapabilityResult } from "@kan/plugin-contract";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { EdgeAgentBus } from "./EdgeAgentBus";
import type { DeviceManager } from "./DeviceManager";
import type { PermissionManager } from "./PermissionManager";
import type { SafetyPolicyStore } from "./SafetyPolicyStore";

export interface CapabilityListing {
  deviceId: string;
  deviceName: string;
  /** Tipo del plugin dueño del dispositivo (ej. "esp32-arduino") — llega hasta el hello del Gateway para identificar qué es cada dispositivo (ADR-053). */
  deviceKind: string;
  capability: CapabilityDescriptor;
}

export type InvokeOutcome =
  | { status: "executed"; result: CapabilityResult }
  | { status: "pending_confirmation"; confirmationId: string };

/**
 * Devuelto por `executeConfirmed()` — a diferencia de `InvokeOutcome`
 * (donde `invoke()` ya conoce `deviceId`/`capabilityName` porque son sus
 * propios argumentos), acá el único dato de entrada es `confirmationId`,
 * así que el resultado necesita traer de vuelta a qué dispositivo/capability
 * correspondía para que quien llama pueda auditar la acción (fix de
 * auditoría de backend: antes esto no dejaba ningún rastro).
 */
export interface ConfirmedOutcome {
  status: "executed";
  result: CapabilityResult;
  deviceId: string;
  capabilityName: string;
}

/**
 * Lista agregada de todo lo invocable ahora mismo (requisito 5) y único
 * punto de entrada para invocar una capability: siempre pasa primero por el
 * Permission Manager (ADR-004) antes de tocar el driver del dispositivo.
 * Este es exactamente el catálogo que, en el próximo incremento, se
 * expondrá al LLM como tools de function-calling.
 */
export class CapabilityRegistry {
  constructor(
    private readonly deviceManager: DeviceManager,
    private readonly permissionManager: PermissionManager,
    private readonly safetyPolicyStore: SafetyPolicyStore,
    private readonly bus: EdgeAgentBus,
    private readonly logger: LoggerPort,
  ) {}

  list(): CapabilityListing[] {
    return this.deviceManager.list().flatMap((device) =>
      device.capabilities.map((capability) => ({
        deviceId: device.id,
        deviceName: device.name,
        deviceKind: device.kind,
        capability,
      })),
    );
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<InvokeOutcome> {
    const device = this.deviceManager.getDevice(deviceId);
    const capability = device?.capabilities.find((c) => c.name === capabilityName);
    if (!device || !capability) {
      throw new Error(`Capability desconocida: ${capabilityName} en dispositivo ${deviceId}`);
    }

    // Segunda capa de defensa en profundidad (docs/16 P1) — la primera vive
    // en ToolResolver, del lado del Gateway. Se valida antes de resolver
    // severidad: un input con forma inválida no debe ni siquiera decidir si
    // requiere confirmación.
    const validation = validateAgainstSchema(capability.inputSchema, input);
    if (!validation.ok) {
      this.logger.info(`Input rechazado por schema: ${capabilityName} en ${deviceId}: ${validation.error}`);
      return { status: "executed", result: { success: false, error: validation.error } };
    }

    const severity = this.safetyPolicyStore.resolveSeverity(deviceId, capability, input);
    this.bus.emit("capability.invoked", { deviceId, capability: capabilityName, severity });

    const decision = this.permissionManager.evaluate(deviceId, capabilityName, severity, input);
    if (decision.outcome === "pending") {
      return { status: "pending_confirmation", confirmationId: decision.confirmation.id };
    }

    const result = await this.execute(deviceId, capabilityName, input);
    return { status: "executed", result };
  }

  /** Ejecuta directo tras una confirmación explícita del Permission Manager. */
  async executeConfirmed(confirmationId: string, approved: boolean): Promise<ConfirmedOutcome | undefined> {
    const confirmation = this.permissionManager.resolve(confirmationId, approved);
    if (!confirmation) return undefined;
    const { deviceId, capabilityName } = confirmation;
    if (!approved) {
      this.logger.info(`Invocación rechazada: ${capabilityName} en ${deviceId}`);
      return { status: "executed", result: { success: false, error: "Rechazado por el usuario" }, deviceId, capabilityName };
    }
    const result = await this.execute(deviceId, capabilityName, confirmation.input);
    return { status: "executed", result, deviceId, capabilityName };
  }

  private async execute(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    const driver = this.deviceManager.getDriverFor(deviceId);
    if (!driver) {
      throw new Error(`No hay driver activo para el dispositivo ${deviceId}`);
    }
    try {
      const result = await driver.invoke(deviceId, capabilityName, input);
      this.logger.info(`Capability ejecutada: ${capabilityName} en ${deviceId}`, { result });
      this.bus.emit("capability.completed", { deviceId, capability: capabilityName, result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Capability falló: ${capabilityName} en ${deviceId}: ${message}`);
      this.bus.emit("capability.failed", { deviceId, capability: capabilityName, error: message });
      return { success: false, error: message };
    }
  }
}
