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

async function buildEdgeAgent() {
  const coreConnection = createFakeCoreConnection();
  const edgeAgent = new EdgeAgent({
    edgeAgentId: "edge-1",
    agentVersion: "0.0.1",
    bus: new EdgeAgentBus(),
    logger: createLogger(),
    configStore: createInMemoryConfigStore(),
    coreConnection,
    updater: createNoopUpdater(),
  });
  await edgeAgent.registerPlugin(new FakeDriver());
  await edgeAgent.bootstrap();
  return { edgeAgent, coreConnection };
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
