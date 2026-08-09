import { describe, expect, it, vi } from "vitest";
import type { MemoryEntry, MemoryStorePort } from "@kan/core";
import type { LoggerPort } from "@kan/plugin-contract";
import type { NotificationServicePort } from "../domain/ports/NotificationServicePort";
import type { Notification } from "../domain/entities/Notification";
import type { DeviceResearchPort, DeviceResearchResult } from "../domain/ports/DeviceResearchPort";
import { GatewayBus } from "./GatewayBus";
import { DeviceEnrichmentService } from "./DeviceEnrichmentService";

function createLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

class FakeMemoryStore implements MemoryStorePort {
  private readonly entries: MemoryEntry[] = [];

  constructor(seed: MemoryEntry[] = []) {
    this.entries = [...seed];
  }

  async list(userId: string, category?: string): Promise<MemoryEntry[]> {
    return this.entries.filter((e) => e.userId === userId && (category === undefined || e.category === category));
  }

  async set(userId: string, category: string, key: string, value: unknown): Promise<MemoryEntry> {
    const entry: MemoryEntry = { userId, category, key, value, updatedAt: new Date().toISOString() };
    this.entries.push(entry);
    return entry;
  }

  async remove(): Promise<void> {}
}

class FakeNotificationService implements NotificationServicePort {
  public readonly notified: Notification[] = [];
  async notify(notification: Notification): Promise<void> {
    this.notified.push(notification);
  }
}

function createResearchPort(
  research: DeviceResearchPort["research"] = async () => ({ summary: "Resumen de prueba." }),
): DeviceResearchPort & { calls: Array<{ kind: string; names: string[] }> } {
  const calls: Array<{ kind: string; names: string[] }> = [];
  return {
    calls,
    research: async (kind, names) => {
      calls.push({ kind, names });
      return research(kind, names);
    },
  };
}

function build(options: {
  memorySeed?: MemoryEntry[];
  research?: DeviceResearchPort["research"];
}) {
  const memoryStore = new FakeMemoryStore(options.memorySeed);
  const researchPort = createResearchPort(options.research);
  const notificationService = new FakeNotificationService();
  const bus = new GatewayBus();
  const logger = createLogger();

  const service = new DeviceEnrichmentService(memoryStore, researchPort, notificationService, bus, logger);

  return { service, memoryStore, researchPort, notificationService, bus, logger };
}

describe("DeviceEnrichmentService", () => {
  it("investiga un deviceKind nuevo y lo guarda en memoria, categoría 'dispositivos'", async () => {
    const { service, memoryStore } = build({
      research: async () => ({ summary: "ESP32-WROOM-32: microcontrolador WiFi/BLE, 3.3V, 30 pines." }),
    });

    service.enrichIfNew("user-1", [{ kind: "esp32-arduino", name: "ESP32 (COM3)" }]);
    await vi.waitFor(async () => {
      expect(await memoryStore.list("user-1", "dispositivos")).toHaveLength(1);
    });

    const [entry] = await memoryStore.list("user-1", "dispositivos");
    expect(entry.key).toBe("esp32-arduino");
    expect(entry.value).toBe("ESP32-WROOM-32: microcontrolador WiFi/BLE, 3.3V, 30 pines.");
  });

  it("no vuelve a investigar un deviceKind que ya tiene memoria guardada", async () => {
    const { service, researchPort } = build({
      memorySeed: [{ userId: "user-1", category: "dispositivos", key: "esp32-arduino", value: "ya sé de esto", updatedAt: "2026-01-01T00:00:00.000Z" }],
    });

    service.enrichIfNew("user-1", [{ kind: "esp32-arduino", name: "ESP32 (COM3)" }]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(researchPort.calls).toHaveLength(0);
  });

  it("agrupa varios dispositivos del mismo kind en una sola llamada de investigación, con todos los nombres únicos", async () => {
    const { service, researchPort } = build({});

    service.enrichIfNew("user-1", [
      { kind: "esp32-arduino", name: "ESP32 (COM3)" },
      { kind: "esp32-arduino", name: "ESP32 (COM3)" },
      { kind: "esp32-arduino", name: "ESP32 (COM4)" },
    ]);
    await vi.waitFor(() => {
      expect(researchPort.calls).toHaveLength(1);
    });

    expect(researchPort.calls[0]).toEqual({ kind: "esp32-arduino", names: ["ESP32 (COM3)", "ESP32 (COM4)"] });
  });

  it("investiga cada kind distinto por separado", async () => {
    const { service, researchPort } = build({});

    service.enrichIfNew("user-1", [
      { kind: "esp32-arduino", name: "ESP32 (COM3)" },
      { kind: "modbus", name: "PLC (192.168.1.50)" },
    ]);
    await vi.waitFor(() => {
      expect(researchPort.calls).toHaveLength(2);
    });

    expect(researchPort.calls.map((c) => c.kind).sort()).toEqual(["esp32-arduino", "modbus"]);
  });

  it("no guarda memoria ni notifica si research() no encuentra nada útil (undefined)", async () => {
    const { service, memoryStore, notificationService } = build({
      research: async () => undefined,
    });

    service.enrichIfNew("user-1", [{ kind: "http-generic", name: "clima" }]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await memoryStore.list("user-1", "dispositivos")).toEqual([]);
    expect(notificationService.notified).toEqual([]);
  });

  it("sin ownerId, no investiga nada (no hay dónde guardar memoria)", async () => {
    const { service, researchPort } = build({});

    service.enrichIfNew(undefined, [{ kind: "esp32-arduino", name: "ESP32 (COM3)" }]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(researchPort.calls).toHaveLength(0);
  });

  it("notifica al usuario cuando encuentra información real", async () => {
    const { service, notificationService } = build({
      research: async (): Promise<DeviceResearchResult> => ({
        summary: "Resumen real del dispositivo.",
        sources: ["https://example.com/esp32"],
      }),
    });

    service.enrichIfNew("user-1", [{ kind: "esp32-arduino", name: "ESP32 (COM3)" }]);
    await vi.waitFor(() => {
      expect(notificationService.notified).toHaveLength(1);
    });

    expect(notificationService.notified[0]).toMatchObject({
      userId: "user-1",
      channel: "chat",
      title: "Investigué tu ESP32 (COM3)",
      severity: "info",
    });
  });

  it("emite el evento device.enriched en el bus con lo necesario para que Gateway grabe la auditoría (mismo patrón que job.fired/job.notification)", async () => {
    const { service, bus } = build({
      research: async () => ({ summary: "Resumen.", sources: ["https://example.com/esp32"] }),
    });
    const handler = vi.fn();
    bus.on("device.enriched", handler);

    service.enrichIfNew("user-1", [{ kind: "esp32-arduino", name: "ESP32 (COM3)" }]);
    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith({
        ownerId: "user-1",
        deviceKind: "esp32-arduino",
        summary: "Resumen.",
        deviceNames: ["ESP32 (COM3)"],
        sources: ["https://example.com/esp32"],
      });
    });
  });

  it("un fallo en research() no rompe enrichIfNew() ni deja nada a medio guardar", async () => {
    const { service, memoryStore, logger } = build({
      research: async () => {
        throw new Error("Gemini caído");
      },
    });

    service.enrichIfNew("user-1", [{ kind: "esp32-arduino", name: "ESP32 (COM3)" }]);
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalled();
    });

    expect(await memoryStore.list("user-1", "dispositivos")).toEqual([]);
  });

  it("dos hellos con el mismo kind nuevo casi al mismo tiempo solo disparan una investigación (evita carrera)", async () => {
    let resolveResearch!: (result: DeviceResearchResult) => void;
    const researchPromise = new Promise<DeviceResearchResult>((resolve) => {
      resolveResearch = resolve;
    });
    const { service, researchPort } = build({
      research: () => researchPromise,
    });

    service.enrichIfNew("user-1", [{ kind: "esp32-arduino", name: "ESP32 (COM3)" }]);
    service.enrichIfNew("user-1", [{ kind: "esp32-arduino", name: "ESP32 (COM3)" }]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(researchPort.calls).toHaveLength(1);
    resolveResearch({ summary: "Resumen." });
  });
});
