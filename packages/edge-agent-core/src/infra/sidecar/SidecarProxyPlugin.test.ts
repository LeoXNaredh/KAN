import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginManifest } from "@kan/plugin-contract";
import type { InstalledPlugin } from "../../domain/entities/InstalledPlugin";
import { NodeProcessLauncher } from "../NodeProcessLauncher";
import { SidecarProxyPlugin } from "./SidecarProxyPlugin";

const FIXTURE_PATH = fileURLToPath(new URL("./__fixtures__/fakeSidecarProcess.mjs", import.meta.url));

const manifest: PluginManifest = {
  id: "kan-plugin-fixture-test",
  version: "0.1.0",
  displayName: "Fixture de prueba",
  kind: "device-driver",
  runtime: "python-sidecar",
  permissions: { devices: ["fixture"], network: false, filesystem: [] },
};

const installedPlugin: InstalledPlugin = {
  pluginId: manifest.id,
  version: manifest.version,
  manifest,
  installDir: "/no/se/usa/en/este/test",
  installedAt: new Date().toISOString(),
};

function makeFixturePlugin(): SidecarProxyPlugin {
  return new SidecarProxyPlugin(installedPlugin, new NodeProcessLauncher(), () => ({
    command: process.execPath,
    args: [FIXTURE_PATH],
  }));
}

describe("SidecarProxyPlugin", () => {
  let plugin: SidecarProxyPlugin | undefined;

  beforeEach(() => {
    delete process.env.FAKE_SIDECAR_BEHAVIOR;
  });

  afterEach(async () => {
    await plugin?.onUnload();
    plugin = undefined;
  });

  it("onLoad() spawnea el proceso real y completa el handshake", async () => {
    plugin = makeFixturePlugin();
    await expect(plugin.onLoad()).resolves.toBeUndefined();
  });

  it("discover() devuelve los dispositivos del sidecar real", async () => {
    plugin = makeFixturePlugin();
    await plugin.onLoad();

    const devices = await plugin.discover();
    expect(devices).toEqual([{ id: "fixture-0", name: "Fixture Device", kind: "fixture" }]);
  });

  it("connect() cachea las capabilities para getCapabilities() síncrono", async () => {
    plugin = makeFixturePlugin();
    await plugin.onLoad();

    expect(plugin.getCapabilities("fixture-0")).toEqual([]);
    await plugin.connect("fixture-0");
    expect(plugin.getCapabilities("fixture-0")).toEqual([
      { name: "ping", description: "Responde pong.", severity: "read-only", supportsDryRun: false },
    ]);
  });

  it("connect() lanza con el error del sidecar cuando ok es false", async () => {
    process.env.FAKE_SIDECAR_BEHAVIOR = "reject-connect";
    plugin = makeFixturePlugin();
    await plugin.onLoad();

    await expect(plugin.connect("fixture-0")).rejects.toThrow(/conexión rechazada a propósito/);
  });

  it("invoke() devuelve el CapabilityResult del sidecar", async () => {
    plugin = makeFixturePlugin();
    await plugin.onLoad();
    await plugin.connect("fixture-0");

    const result = await plugin.invoke("fixture-0", "ping", { hola: "mundo" });
    expect(result).toEqual({ success: true, data: { echoed: { hola: "mundo" } } });
  });

  it("disconnect() limpia las capabilities cacheadas", async () => {
    plugin = makeFixturePlugin();
    await plugin.onLoad();
    await plugin.connect("fixture-0");
    expect(plugin.getCapabilities("fixture-0")).not.toEqual([]);

    await plugin.disconnect("fixture-0");
    expect(plugin.getCapabilities("fixture-0")).toEqual([]);
  });

  it("listTargets() cachea desde connect() (vacío para este fixture)", async () => {
    plugin = makeFixturePlugin();
    await plugin.onLoad();
    expect(plugin.listTargets("fixture-0")).toEqual([]);
    await plugin.connect("fixture-0");
    expect(plugin.listTargets("fixture-0")).toEqual([]);
  });

  it("onUnload() manda shutdown y el proceso real termina sin colgarse", async () => {
    plugin = makeFixturePlugin();
    await plugin.onLoad();
    await expect(plugin.onUnload()).resolves.toBeUndefined();
    plugin = undefined; // ya se descargó, afterEach no debe volver a llamar onUnload()
  });

  it("onLoad() rechaza con un error accionable si el proceso muere antes del handshake", async () => {
    process.env.FAKE_SIDECAR_BEHAVIOR = "crash-before-hello";
    plugin = makeFixturePlugin();

    await expect(plugin.onLoad()).rejects.toThrow(/terminó antes de completar el handshake/);
    plugin = undefined; // el proceso ya murió solo, no hay nada que desmontar
  });
});
