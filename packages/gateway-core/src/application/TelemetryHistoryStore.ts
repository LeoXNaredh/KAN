import type { AgentRegistry } from "./AgentRegistry";

const MAX_READINGS_PER_REF = 200;

/** Una lectura ya resuelta a un único número — nunca JSON crudo (mismo criterio que SequenceStepReport). */
export interface TelemetryReading {
  edgeAgentId: string;
  deviceName: string;
  description: string;
  value: number;
  at: string;
}

export interface TelemetrySensorSummary {
  ref: string;
  edgeAgentId: string;
  deviceName: string;
  description: string;
  latest: TelemetryReading;
}

/**
 * Historial de telemetría en memoria (dashboard de sensores) — sin tabla en
 * Supabase a propósito (no existe ninguna hoy, ver plan): 200 lecturas por
 * ref, ring buffer, se pierde al reiniciar el Gateway. Se alimenta sola vía
 * `Gateway.bootstrap()` escuchando `bus.on("tool.executed", ...)` — nunca
 * hay que llamar a `record()` desde cada lugar que ejecuta una capability,
 * cualquier lectura real del sistema (chat, alertas, este mismo dashboard)
 * la termina alimentando.
 *
 * Mismo patrón que `GlobalCapabilityRegistry`: `agentRegistry` opcional para
 * filtrar por dueño — sin él, `list()`/`history()` no filtran (retrocompatible
 * con los tests que la construyen directo). Filtra por `edgeAgentId`
 * snapshotteado en cada lectura (no por `capabilityRegistry.resolve(ref)`,
 * que deja de existir apenas el Edge Agent se desconecta) — `AgentRegistry`
 * conserva el registro y su `ownerId` mucho después de la desconexión
 * (`markOffline()` no borra nada, se poda recién a los 90 días), así que el
 * historial de un sensor offline se sigue pudiendo filtrar por dueño.
 */
export class TelemetryHistoryStore {
  private readonly readings = new Map<string, TelemetryReading[]>();

  constructor(private readonly agentRegistry?: AgentRegistry) {}

  record(ref: string, reading: TelemetryReading): void {
    const existing = this.readings.get(ref) ?? [];
    existing.push(reading);
    if (existing.length > MAX_READINGS_PER_REF) existing.shift();
    this.readings.set(ref, existing);
  }

  private canSee(edgeAgentId: string, requestingUserId?: string): boolean {
    if (!this.agentRegistry || requestingUserId === undefined) return true;
    const ownerId = this.agentRegistry.get(edgeAgentId)?.ownerId;
    return ownerId === undefined || ownerId === requestingUserId;
  }

  history(ref: string, requestingUserId?: string): TelemetryReading[] {
    const readings = this.readings.get(ref) ?? [];
    if (readings.length === 0) return [];
    if (!this.canSee(readings[0].edgeAgentId, requestingUserId)) return [];
    return readings;
  }

  /** Un resumen por ref conocido (conectado o no) — el Gateway agrega `connected` cruzando contra `capabilityRegistry`. */
  list(requestingUserId?: string): TelemetrySensorSummary[] {
    const summaries: TelemetrySensorSummary[] = [];
    for (const [ref, readings] of this.readings) {
      const latest = readings[readings.length - 1];
      if (!latest || !this.canSee(latest.edgeAgentId, requestingUserId)) continue;
      summaries.push({ ref, edgeAgentId: latest.edgeAgentId, deviceName: latest.deviceName, description: latest.description, latest });
    }
    return summaries;
  }
}
