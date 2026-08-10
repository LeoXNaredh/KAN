import { describe, expect, it } from "vitest";
import type {
  ConnectRequestMessage,
  ConnectResultMessage,
  DisconnectRequestMessage,
  DisconnectResultMessage,
  DiscoverRequestMessage,
  DiscoverResultMessage,
  EdgeToSidecarMessage,
  InvokeRequestMessage,
  InvokeResultMessage,
  ListTargetsRequestMessage,
  ListTargetsResultMessage,
  SidecarHeartbeatMessage,
  SidecarHelloAckMessage,
  SidecarHelloMessage,
  SidecarShutdownMessage,
  SidecarToEdgeMessage,
} from "./sidecarProtocol";
import fixtures from "./sidecarProtocolFixtures.json";

/**
 * Un mismo fixture (sidecarProtocolFixtures.json) lo leen este test TS y
 * `test_protocol.py` (kan-plugin-sdk-py) — si alguien cambia un campo de un
 * lado sin el otro, alguno de los dos rompe. Las asignaciones `as` de abajo
 * son el chequeo de forma real (lo verifica `tsc --noEmit`, no `vitest run`
 * por sí solo, ya que vitest transpila sin chequear tipos: `resolveJsonModule`
 * infiere `type: string`, no el literal exacto, así que hace falta `as` en
 * vez de `satisfies` acá) — las aserciones runtime son el chequeo que sí
 * corre en cada `pnpm test`.
 */

const helloFixture = fixtures.sidecar_hello as SidecarHelloMessage;
const helloAckFixture = fixtures.sidecar_hello_ack as SidecarHelloAckMessage;
const discoverFixture = fixtures.discover as DiscoverRequestMessage;
const discoverResultFixture = fixtures["discover.result"] as DiscoverResultMessage;
const connectFixture = fixtures.connect as ConnectRequestMessage;
const connectResultFixture = fixtures["connect.result"] as ConnectResultMessage;
const disconnectFixture = fixtures.disconnect as DisconnectRequestMessage;
const disconnectResultFixture = fixtures["disconnect.result"] as DisconnectResultMessage;
const invokeFixture = fixtures.invoke as InvokeRequestMessage;
const invokeResultFixture = fixtures["invoke.result"] as InvokeResultMessage;
const listTargetsFixture = fixtures.list_targets as ListTargetsRequestMessage;
const listTargetsResultFixture = fixtures["list_targets.result"] as ListTargetsResultMessage;
const heartbeatFixture = fixtures.heartbeat as SidecarHeartbeatMessage;
const shutdownFixture = fixtures.shutdown as SidecarShutdownMessage;

describe("sidecarProtocol fixtures", () => {
  it("sidecar_hello trae protocolVersion, pluginId, pluginVersion y token", () => {
    expect(helloFixture.type).toBe("sidecar_hello");
    expect(typeof helloFixture.protocolVersion).toBe("string");
    expect(typeof helloFixture.pluginId).toBe("string");
    expect(typeof helloFixture.pluginVersion).toBe("string");
    expect(typeof helloFixture.token).toBe("string");
  });

  it("sidecar_hello_ack siempre trae ok: true", () => {
    expect(helloAckFixture).toEqual({ type: "sidecar_hello_ack", ok: true });
  });

  it("discover / discover.result correlacionan por requestId", () => {
    expect(discoverResultFixture.requestId).toBe(discoverFixture.requestId);
    expect(Array.isArray(discoverResultFixture.devices)).toBe(true);
  });

  it("connect.result trae capabilities en la misma respuesta (sin mensaje separado)", () => {
    expect(connectResultFixture.requestId).toBe(connectFixture.requestId);
    expect(connectResultFixture.ok).toBe(true);
    expect(Array.isArray(connectResultFixture.capabilities)).toBe(true);
    expect(connectResultFixture.capabilities?.[0]?.name).toBe("detect_objects");
  });

  it("disconnect / disconnect.result correlacionan por requestId", () => {
    expect(disconnectResultFixture.requestId).toBe(disconnectFixture.requestId);
    expect(disconnectResultFixture.ok).toBe(true);
  });

  it("invoke / invoke.result correlacionan por requestId y devuelven CapabilityResult", () => {
    expect(invokeResultFixture.requestId).toBe(invokeFixture.requestId);
    expect(invokeResultFixture.result.success).toBe(true);
  });

  it("list_targets / list_targets.result correlacionan por requestId", () => {
    expect(listTargetsResultFixture.requestId).toBe(listTargetsFixture.requestId);
    expect(Array.isArray(listTargetsResultFixture.targets)).toBe(true);
  });

  it("heartbeat trae un timestamp ISO", () => {
    expect(() => new Date(heartbeatFixture.at).toISOString()).not.toThrow();
  });

  it("shutdown no lleva payload más allá del type", () => {
    expect(shutdownFixture).toEqual({ type: "shutdown" });
  });

  it("los mensajes sidecar->edge y edge->sidecar no se superponen", () => {
    const sidecarToEdgeTypes: SidecarToEdgeMessage["type"][] = [
      "sidecar_hello",
      "discover.result",
      "connect.result",
      "disconnect.result",
      "invoke.result",
      "list_targets.result",
      "heartbeat",
    ];
    const edgeToSidecarTypes: EdgeToSidecarMessage["type"][] = [
      "sidecar_hello_ack",
      "discover",
      "connect",
      "disconnect",
      "invoke",
      "list_targets",
      "shutdown",
    ];
    const overlap = sidecarToEdgeTypes.filter((type) => (edgeToSidecarTypes as string[]).includes(type));
    expect(overlap).toEqual([]);
  });
});
