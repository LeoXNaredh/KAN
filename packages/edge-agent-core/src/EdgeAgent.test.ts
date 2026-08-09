import { describe, expect, it, vi } from "vitest";
import type {
  CapabilityDescriptor,
  CapabilityResult,
  DeviceDescriptor,
  EdgeToCoreMessage,
  PluginManifest,
} from "@kan/plugin-contract";
import { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import { EdgeAgentBus } from "./application/EdgeAgentBus";
import type { LoggerPort } from "./domain/ports/LoggerPort";
import type { ConfigStorePort } from "./domain/ports/ConfigStorePort";
import type { CoreConnectionPort } from "./domain/ports/CoreConnectionPort";
import type { UpdaterPort } from "./domain/ports/UpdaterPort";
import { EdgeAgent } from "./EdgeAgent";

function createLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createInMemoryConfigStore(): ConfigStorePort {
  const data = new Map<string, unknown>();
  return {
    get: <T>(key: string) => data.get(key) as T | undefined,
    set: <T>(key: string, value: T) => {
      data.set(key, value);
    },
    all: () => Object.fromEntries(data),
  };
}

function createFakeCoreConnection(): CoreConnectionPort & { send: ReturnType<typeof vi.fn> } {
  return {
    status: "disconnected",
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    onStatusChange: vi.fn(() => () => {}),
  };
}

function createNoopUpdater(): UpdaterPort {
  return { checkForUpdates: async () => ({ updateAvailable: false }) };
}

class FakeDriver extends KanDeviceDriverPlugin {
  readonly kind = "fake";
  readonly manifest: PluginManifest = {
    id: "fake-driver",
    version: "0.0.1",
    displayName: "Fake Driver",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: { devices: ["fake"], network: false, filesystem: [] },
  };

  async discover(): Promise<DeviceDescriptor[]> {
    return [{ id: "fake-1", name: "Fake Device", kind: this.kind }];
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  getCapabilities(): CapabilityDescriptor[] {
    return [
      { name: "read_only_cap", description: "...", severity: "read-only", supportsDryRun: false },
      {
        name: "toggle_reversible",
        description: "...",
        severity: "reversible",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { on: { type: "boolean" } },
          required: ["on"],
        },
      },
      { name: "dangerous_cap", description: "...", severity: "irreversible-material", supportsDryRun: false },
    ];
  }

  async invoke(_deviceId: string, capabilityName: string): Promise<CapabilityResult> {
    return { success: true, data: { capabilityName } };
  }
}

async function buildEdgeAgent(configStore: ConfigStorePort = createInMemoryConfigStore()) {
  const coreConnection = createFakeCoreConnection();
  const edgeAgent = new EdgeAgent({
    edgeAgentId: "edge-1",
    agentVersion: "0.0.1",
    bus: new EdgeAgentBus(),
    logger: createLogger(),
    configStore,
    coreConnection,
    updater: createNoopUpdater(),
  });
  await edgeAgent.registerPlugin(new FakeDriver());
  await edgeAgent.bootstrap();
  // P8 (ADR-041): register() ya no habilita de una — hace falta aprobar los
  // permisos declarados (deny-by-default) antes de que el driver descubra
  // dispositivos. Estos tests no ejercitan el gate en sí (ver
  // PluginManager.test.ts para eso), solo necesitan "fake-1" disponible.
  await edgeAgent.approvePluginPermissions("fake-driver");
  return { edgeAgent, coreConnection };
}

function statusChangeHandler(coreConnection: CoreConnectionPort): (status: string) => void {
  const handler = (coreConnection.onStatusChange as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
  if (!handler) throw new Error("onStatusChange no fue registrado");
  return handler;
}

function auditLocalMessages(coreConnection: { send: ReturnType<typeof vi.fn> }): EdgeToCoreMessage[] {
  return coreConnection.send.mock.calls
    .map((call) => call[0] as EdgeToCoreMessage)
    .filter((message) => message.type === "audit.local");
}

describe("EdgeAgent.invokeCapability() — auditoría de invocaciones manuales (docs/16 P4, ADR-025)", () => {
  it("envía audit.local con success:true cuando una capability read-only se ejecuta directo", async () => {
    const { edgeAgent, coreConnection } = await buildEdgeAgent();

    const outcome = await edgeAgent.invokeCapability("fake-1", "read_only_cap", {});

    expect(outcome.status).toBe("executed");
    const messages = auditLocalMessages(coreConnection);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "audit.local",
      deviceId: "fake-1",
      capability: "read_only_cap",
      success: true,
    });
  });

  it("envía audit.local con success:false y el error cuando el input no cumple el inputSchema", async () => {
    const { edgeAgent, coreConnection } = await buildEdgeAgent();

    const outcome = await edgeAgent.invokeCapability("fake-1", "toggle_reversible", { on: "no-es-boolean" });

    expect(outcome.status).toBe("executed");
    const messages = auditLocalMessages(coreConnection);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "audit.local",
      deviceId: "fake-1",
      capability: "toggle_reversible",
      success: false,
    });
    expect((messages[0] as { error?: string }).error).toMatch(/Argumentos inválidos/);
  });

  it("NO envía audit.local cuando la capability queda pending_confirmation (fuera de alcance de este incremento)", async () => {
    const { edgeAgent, coreConnection } = await buildEdgeAgent();

    const outcome = await edgeAgent.invokeCapability("fake-1", "dangerous_cap", {});

    expect(outcome.status).toBe("pending_confirmation");
    expect(auditLocalMessages(coreConnection)).toHaveLength(0);
  });

  it("handleCoreMessage() (dispatch del Gateway) no envía audit.local — ese camino se audita como actor 'llm' del lado del Gateway", async () => {
    const { coreConnection, edgeAgent } = await buildEdgeAgent();
    let dispatchHandler: ((message: { type: "agent_task.dispatch" } & Record<string, unknown>) => void) | undefined;
    (coreConnection.onMessage as ReturnType<typeof vi.fn>).mock.calls.forEach(([handler]) => {
      dispatchHandler = handler;
    });
    expect(dispatchHandler).toBeDefined();

    await dispatchHandler?.({
      type: "agent_task.dispatch",
      taskId: "t1",
      deviceId: "fake-1",
      capability: "read_only_cap",
      severity: "read-only",
      requiresConfirmation: false,
      payload: {},
      issuedAt: new Date().toISOString(),
    });
    // deja que la promesa interna de handleCoreMessage() resuelva
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(auditLocalMessages(coreConnection)).toHaveLength(0);
    expect(coreConnection.send).toHaveBeenCalledWith(expect.objectContaining({ type: "telemetry", taskId: "t1" }));

    void edgeAgent;
  });
});

describe("EdgeAgent.bootstrap() — pairingToken en el hello (docs/19 P2, incremento 3)", () => {
  it("incluye pairingToken en el hello si configStore lo tiene guardado", async () => {
    const configStore = createInMemoryConfigStore();
    configStore.set("pairingToken", "secreto-guardado");
    const { coreConnection } = await buildEdgeAgent(configStore);

    statusChangeHandler(coreConnection)("connected");

    expect(coreConnection.send).toHaveBeenCalledWith(expect.objectContaining({ type: "hello", pairingToken: "secreto-guardado" }));
  });

  it("no incluye pairingToken (undefined) si configStore no lo tiene — agente todavía no vinculado", async () => {
    const { coreConnection } = await buildEdgeAgent();

    statusChangeHandler(coreConnection)("connected");

    expect(coreConnection.send).toHaveBeenCalledWith(expect.objectContaining({ type: "hello", pairingToken: undefined }));
  });
});

describe("EdgeAgent — gate de permisos de plugins deny-by-default (P8, ADR-041)", () => {
  async function buildUnapprovedEdgeAgent() {
    const configStore = createInMemoryConfigStore();
    const coreConnection = createFakeCoreConnection();
    const edgeAgent = new EdgeAgent({
      edgeAgentId: "edge-1",
      agentVersion: "0.0.1",
      bus: new EdgeAgentBus(),
      logger: createLogger(),
      configStore,
      coreConnection,
      updater: createNoopUpdater(),
    });
    await edgeAgent.registerPlugin(new FakeDriver());
    await edgeAgent.bootstrap();
    return { edgeAgent, coreConnection };
  }

  it("un plugin recién registrado no descubre dispositivos hasta que se aprueban sus permisos", async () => {
    const { edgeAgent } = await buildUnapprovedEdgeAgent();

    expect(edgeAgent.listPendingPluginPermissions().map((i) => i.manifest.id)).toEqual(["fake-driver"]);
    await expect(edgeAgent.invokeCapability("fake-1", "read_only_cap", {})).rejects.toThrow(
      /Capability desconocida/,
    );
  });

  it("approvePluginPermissions() habilita el plugin y descubre sus dispositivos de inmediato", async () => {
    const { edgeAgent } = await buildUnapprovedEdgeAgent();

    await edgeAgent.approvePluginPermissions("fake-driver");

    expect(edgeAgent.listPendingPluginPermissions()).toHaveLength(0);
    const outcome = await edgeAgent.invokeCapability("fake-1", "read_only_cap", {});
    expect(outcome.status).toBe("executed");
  });

  it("rejectPluginPermissions() deja el plugin sin dispositivos, sin volver a aparecer como pendiente", async () => {
    const { edgeAgent } = await buildUnapprovedEdgeAgent();

    edgeAgent.rejectPluginPermissions("fake-driver");

    expect(edgeAgent.listPendingPluginPermissions()).toHaveLength(0);
    await expect(edgeAgent.invokeCapability("fake-1", "read_only_cap", {})).rejects.toThrow(
      /Capability desconocida/,
    );
  });
});

describe("EdgeAgent.rediscoverDevices() — sincronizar config de plugin sin reiniciar el proceso", () => {
  class MutableFakeDriver extends KanDeviceDriverPlugin {
    readonly kind = "mutable-fake";
    readonly manifest: PluginManifest = {
      id: "mutable-fake-driver",
      version: "0.0.1",
      displayName: "Mutable Fake Driver",
      kind: "device-driver",
      runtime: "in-process-ts",
      permissions: { devices: ["mutable-fake"], network: false, filesystem: [] },
    };
    // Simula `process.env.KAN_*` cambiando entre llamadas a discover() —
    // exactamente el escenario real: `apps/desktop` sincroniza config nueva
    // y llama a rediscoverDevices() sin reiniciar el proceso Electron.
    deviceIds: string[] = ["device-a"];

    async discover(): Promise<DeviceDescriptor[]> {
      return this.deviceIds.map((id) => ({ id, name: id, kind: this.kind }));
    }
    async connect(): Promise<void> {}
    async disconnect(): Promise<void> {}
    getCapabilities(): CapabilityDescriptor[] {
      return [];
    }
    async invoke(): Promise<CapabilityResult> {
      return { success: true };
    }
  }

  it("vuelve a correr discover() en los plugins ya habilitados y agrega los dispositivos nuevos que aparezcan", async () => {
    const driver = new MutableFakeDriver();
    const edgeAgent = new EdgeAgent({
      edgeAgentId: "edge-1",
      agentVersion: "0.0.1",
      bus: new EdgeAgentBus(),
      logger: createLogger(),
      configStore: createInMemoryConfigStore(),
      coreConnection: createFakeCoreConnection(),
      updater: createNoopUpdater(),
    });
    await edgeAgent.registerPlugin(driver);
    await edgeAgent.bootstrap();
    await edgeAgent.approvePluginPermissions("mutable-fake-driver");

    expect(edgeAgent.listDevices().map((d) => d.id)).toEqual(["device-a"]);

    driver.deviceIds = ["device-a", "device-b"];
    await edgeAgent.rediscoverDevices();

    expect(
      edgeAgent
        .listDevices()
        .map((d) => d.id)
        .sort(),
    ).toEqual(["device-a", "device-b"]);
  });
});
