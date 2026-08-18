import type { CapabilityDescriptor } from "@kan/plugin-contract";
import type { GlobalCapability } from "../domain/entities/GlobalCapability";
import type { GatewayBus } from "./GatewayBus";
import type { AgentRegistry } from "./AgentRegistry";

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
  /**
   * Índice plano ref -> capability (fix de auditoría de backend #6):
   * `resolve()` se llama en cada ejecución de tool (hot path, un tool call
   * del LLM por vez) — antes hacía `list()` completo (aplana TODOS los
   * agentes conectados, de todos los usuarios) + `.find()` lineal, costo
   * O(total de capabilities del sistema) por cada llamada. Mantenido
   * incrementalmente en `sync()`/`removeAgent()`, nunca recalculado entero.
   */
  private readonly byRef = new Map<string, GlobalCapability>();

  /**
   * `agentRegistry` es opcional (P2 incremento 4) — sin él, `list()` no
   * filtra (comportamiento anterior a este incremento, el que siguen
   * usando `TaskOrchestrator.test.ts`/`ToolExecutor.test.ts` al construir
   * esta clase directo). Solo `Gateway.ts` lo inyecta de verdad.
   */
  constructor(
    private readonly bus: GatewayBus,
    private readonly agentRegistry?: AgentRegistry,
  ) {}

  sync(edgeAgentId: string, capabilities: Array<{ deviceId: string; deviceName?: string; capability: CapabilityDescriptor }>): void {
    const entries = capabilities.map(({ deviceId, deviceName, capability }) => ({
      // Prefijo fijo `c_`: `edgeAgentId.slice(0, 8)` es un pedazo de UUID —
      // sin esto, cualquier agente cuyo id empezara con un dígito (ej.
      // "73348d00...") producía un ref que arranca con número, y Gemini
      // rechaza esos nombres de función ("must start with a letter or an
      // underscore"). `sanitize()` limpia caracteres inválidos en el medio
      // pero no garantiza el primer carácter.
      ref: `c_${sanitize(edgeAgentId.slice(0, 8))}_${sanitize(deviceId)}_${sanitize(capability.name)}`,
      edgeAgentId,
      deviceId,
      // Opcional (varios tests/call sites construyen el hello a mano sin
      // este campo) — sin nombre humano real, cae al deviceId, mejor que
      // dejarlo vacío para kan_run_sequence (ver GlobalCapability.deviceName).
      deviceName: deviceName ?? deviceId,
      capability,
    }));
    this.removeAgent(edgeAgentId);
    this.byAgent.set(edgeAgentId, entries);
    for (const entry of entries) this.byRef.set(entry.ref, entry);
    this.bus.emit("capability.synced", { edgeAgentId, count: entries.length });
  }

  removeAgent(edgeAgentId: string): void {
    const previous = this.byAgent.get(edgeAgentId);
    if (previous) {
      for (const entry of previous) this.byRef.delete(entry.ref);
    }
    this.byAgent.delete(edgeAgentId);
  }

  /** Mismo criterio que `AgentRegistry.list()`: sin `agentRegistry` inyectado o sin `requestingUserId`, no filtra. */
  list(requestingUserId?: string): GlobalCapability[] {
    const all = Array.from(this.byRef.values());
    if (!this.agentRegistry || requestingUserId === undefined) return all;
    return all.filter((c) => {
      const ownerId = this.agentRegistry!.get(c.edgeAgentId)?.ownerId;
      return ownerId === undefined || ownerId === requestingUserId;
    });
  }

  /** Sin filtro de ownership a propósito, igual que antes — `Gateway.executeTool()` ya hace su propio chequeo de dueño después de resolver. */
  resolve(ref: string): GlobalCapability | undefined {
    return this.byRef.get(ref);
  }
}
