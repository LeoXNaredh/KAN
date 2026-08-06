import type { ActionSeverity, CapabilityDescriptor } from "@kan/plugin-contract";
import type { SafetyPolicyEntry } from "../domain/entities/SafetyPolicyEntry";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";
import type { EdgeAgentBus } from "./EdgeAgentBus";

const KEY_PREFIX = "safetyPolicy:";

/**
 * Safety Policy local por dispositivo (docs/00, sistema de Safety Policy):
 * permite que el usuario reclasifique la severidad de una capability para
 * un target físico concreto (ej. "reversible" para el pin del LED, pero
 * "irreversible-material" para el pin del relé de una bomba), sin tocar
 * código de ningún plugin. Persistida vía ConfigStorePort — el mismo
 * mecanismo que ya usa PluginManager para el estado de plugins habilitados.
 */
export class SafetyPolicyStore {
  constructor(
    private readonly configStore: ConfigStorePort,
    private readonly bus: EdgeAgentBus,
  ) {}

  get(deviceId: string, target: string): SafetyPolicyEntry | undefined {
    return this.readDevicePolicy(deviceId)[target];
  }

  listForDevice(deviceId: string): SafetyPolicyEntry[] {
    return Object.values(this.readDevicePolicy(deviceId));
  }

  set(deviceId: string, target: string, override: { severity: ActionSeverity; alias?: string }): SafetyPolicyEntry {
    const policy = this.readDevicePolicy(deviceId);
    const previousSeverity = policy[target]?.severity;

    const entry: SafetyPolicyEntry = {
      deviceId,
      target,
      alias: override.alias,
      severity: override.severity,
      updatedAt: new Date().toISOString(),
    };
    policy[target] = entry;
    this.configStore.set(this.keyFor(deviceId), policy);

    this.bus.emit("safety_policy.changed", { entry, previousSeverity });
    return entry;
  }

  /**
   * Severidad efectiva para invocar `capability` con `input` en `deviceId`:
   * el override del usuario si existe, si no la severidad declarada por la
   * capability (regla 4: sin configurar => siempre la más restrictiva
   * conocida, nunca se degrada por defecto). Capabilities sin `targetParam`
   * no son direccionables por target y siempre usan su severidad declarada.
   */
  resolveSeverity(deviceId: string, capability: CapabilityDescriptor, input: unknown): ActionSeverity {
    if (!capability.targetParam) return capability.severity;

    const target = extractTarget(input, capability.targetParam);
    if (target === undefined) return capability.severity;

    const override = this.get(deviceId, target);
    return override?.severity ?? capability.severity;
  }

  private readDevicePolicy(deviceId: string): Record<string, SafetyPolicyEntry> {
    return this.configStore.get<Record<string, SafetyPolicyEntry>>(this.keyFor(deviceId)) ?? {};
  }

  private keyFor(deviceId: string): string {
    return `${KEY_PREFIX}${deviceId}`;
  }
}

function extractTarget(input: unknown, targetParam: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[targetParam];
  if (value === undefined || value === null) return undefined;
  return String(value);
}
