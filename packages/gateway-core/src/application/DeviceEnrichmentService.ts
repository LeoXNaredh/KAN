import type { LoggerPort } from "@kan/plugin-contract";
import type { MemoryStorePort } from "@kan/core";
import type { DeviceResearchPort } from "../domain/ports/DeviceResearchPort";
import type { NotificationServicePort } from "../domain/ports/NotificationServicePort";
import type { GatewayBus } from "./GatewayBus";

const MEMORY_CATEGORY = "dispositivos";

function groupNamesByKind(devices: Array<{ kind: string; name: string }>): Map<string, string[]> {
  const byKind = new Map<string, string[]>();
  for (const { kind, name } of devices) {
    const names = byKind.get(kind) ?? [];
    if (!names.includes(name)) names.push(name);
    byKind.set(kind, names);
  }
  return byKind;
}

/**
 * Investiga automáticamente un tipo de dispositivo la primera vez que
 * aparece en el `hello` de un Edge Agent (ADR-053) — nunca bloquea la
 * conexión: `enrichIfNew()` dispara `run()` en background y traga cualquier
 * error, mismo criterio best-effort que ya usa el resto del Gateway
 * (ej. `notificationService`/`fetchGateway` del lado de la web).
 *
 * Clave de memoria = `deviceKind`, no el dispositivo físico individual:
 * specs/pines/voltajes son propiedades del tipo de dispositivo, no de la
 * unidad conectada — dos ESP32 distintos del mismo usuario no se investigan
 * dos veces.
 */
export class DeviceEnrichmentService {
  // `${ownerId}:${kind}` en curso — evita carreras duplicadas si dos hellos
  // con el mismo kind nuevo llegan casi juntos (ej. dos agentes del mismo
  // usuario). No sobrevive a un reinicio del proceso, igual que AgentRegistry.
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly memoryStore: MemoryStorePort,
    private readonly researchPort: DeviceResearchPort,
    private readonly notificationService: NotificationServicePort,
    private readonly bus: GatewayBus,
    private readonly logger: LoggerPort,
  ) {}

  enrichIfNew(ownerId: string | undefined, devices: Array<{ kind: string; name: string }>): void {
    if (!ownerId || devices.length === 0) return; // sin dueño, no hay dónde guardar memoria
    void this.run(ownerId, devices).catch((error) => {
      this.logger.error(`[DeviceEnrichmentService] falló: ${error}`);
    });
  }

  private async run(ownerId: string, devices: Array<{ kind: string; name: string }>): Promise<void> {
    const namesByKind = groupNamesByKind(devices);
    const known = await this.memoryStore.list(ownerId, MEMORY_CATEGORY);
    const knownKinds = new Set(known.map((memory) => memory.key));

    for (const [kind, names] of namesByKind) {
      const lockKey = `${ownerId}:${kind}`;
      if (knownKinds.has(kind) || this.inFlight.has(lockKey)) continue;

      this.inFlight.add(lockKey);
      try {
        await this.enrichOne(ownerId, kind, names);
      } finally {
        this.inFlight.delete(lockKey);
      }
    }
  }

  private async enrichOne(ownerId: string, kind: string, names: string[]): Promise<void> {
    const result = await this.researchPort.research(kind, names);
    if (!result) return;

    await this.memoryStore.set(ownerId, MEMORY_CATEGORY, kind, result.summary);
    // La auditoría se graba en Gateway.bootstrap() escuchando este mismo
    // evento — mismo patrón que job.fired/job.notification (el emisor real
    // nunca conoce AuditService directo, evita una dependencia circular:
    // AuditService lo construye el propio Gateway en su constructor).
    this.bus.emit("device.enriched", {
      ownerId,
      deviceKind: kind,
      summary: result.summary,
      deviceNames: names,
      sources: result.sources,
    });

    const title = `Investigué tu ${names[0] ?? kind}`;
    await this.notificationService.notify({
      userId: ownerId,
      channel: "chat",
      title,
      body: result.summary.slice(0, 200),
      severity: "info",
    });
  }
}
