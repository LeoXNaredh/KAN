import type { CapabilityDescriptor } from "@kan/plugin-contract";
import type { GlobalCapability } from "../domain/entities/GlobalCapability";
import type { GatewayBus } from "./GatewayBus";

function sanitize(part: string): string {
  return part.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Catálogo agregado de capabilities de todos los Edge Agents conectados
 * (docs/12 §3). `ref` es único por construcción (incluye edgeAgentId +
 * deviceId) y seguro como nombre de tool para cualquier proveedor de IA.
 */
export class GlobalCapabilityRegistry {
  private readonly byAgent = new Map<string, GlobalCapability[]>();

  constructor(private readonly bus: GatewayBus) {}

  sync(edgeAgentId: string, capabilities: Array<{ deviceId: string; capability: CapabilityDescriptor }>): void {
    const entries = capabilities.map(({ deviceId, capability }) => ({
      ref: `${sanitize(edgeAgentId.slice(0, 8))}_${sanitize(deviceId)}_${sanitize(capability.name)}`,
      edgeAgentId,
      deviceId,
      capability,
    }));
    this.byAgent.set(edgeAgentId, entries);
    this.bus.emit("capability.synced", { edgeAgentId, count: entries.length });
  }

  removeAgent(edgeAgentId: string): void {
    this.byAgent.delete(edgeAgentId);
  }

  list(): GlobalCapability[] {
    return Array.from(this.byAgent.values()).flat();
  }

  resolve(ref: string): GlobalCapability | undefined {
    return this.list().find((c) => c.ref === ref);
  }
}
