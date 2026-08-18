import { describe, expect, it, vi } from "vitest";
import type { DeviceDiscoveryService } from "./DeviceDiscoveryService";
import { DeviceDiscoveryPlugin } from "./DeviceDiscoveryPlugin";
import type { DiscoveredDevice, DiscoveryResult } from "../domain/entities/DiscoveredDevice";

function fakeResult(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return { devices: [], scannedAt: new Date("2026-01-01T00:00:00.000Z"), durationMs: 5, ...overrides };
}

function fakeService(
  scan: () => Promise<DiscoveryResult>,
  scanSerial: () => Promise<DiscoveredDevice[]> = async () => [],
): DeviceDiscoveryService {
  return { scan, scanSerial } as unknown as DeviceDiscoveryService;
}

describe("DeviceDiscoveryPlugin", () => {
  it("discover() expone el host del Edge Agent cuando no hay ningún periférico serial visible", async () => {
    const plugin = new DeviceDiscoveryPlugin(fakeService(async () => fakeResult()));

    const devices = await plugin.discover();

    expect(devices).toEqual([{ id: "edge-agent-host", name: "Detección de dispositivos", kind: "device-discovery" }]);
  });

  it("discover() agrega un pseudo-dispositivo por cada periférico serial visible (detección en caliente)", async () => {
    const pico: DiscoveredDevice = {
      id: "serial:COM7",
      transport: "serial",
      port: "COM7",
      name: "Raspberry Pi Pico",
      confidence: "exact",
      raw: {},
    };
    const plugin = new DeviceDiscoveryPlugin(fakeService(async () => fakeResult(), async () => [pico]));

    const devices = await plugin.discover();

    expect(devices).toEqual([
      { id: "edge-agent-host", name: "Detección de dispositivos", kind: "device-discovery" },
      {
        id: "serial:COM7",
        name: "Raspberry Pi Pico",
        kind: "discovered-serial",
        transport: "serial",
        address: "COM7",
      },
    ]);
  });

  it("discover() no revienta si la enumeración serial falla — sigue devolviendo al menos el host", async () => {
    const plugin = new DeviceDiscoveryPlugin(
      fakeService(
        async () => fakeResult(),
        () => Promise.reject(new Error("puerto ocupado")),
      ),
    );

    const devices = await plugin.discover();

    expect(devices).toEqual([{ id: "edge-agent-host", name: "Detección de dispositivos", kind: "device-discovery" }]);
  });

  it("getCapabilities() de un pseudo-dispositivo serial es vacío — informativo, no controlable", () => {
    const plugin = new DeviceDiscoveryPlugin(fakeService(async () => fakeResult()));

    expect(plugin.getCapabilities("serial:COM7")).toEqual([]);
  });

  it("connect() de un pseudo-dispositivo serial no dispara ningún escaneo — nada que abrir", async () => {
    const scan = vi.fn(async () => fakeResult());
    const plugin = new DeviceDiscoveryPlugin(fakeService(scan));

    await plugin.connect("serial:COM7");

    expect(scan).not.toHaveBeenCalled();
  });

  it("expone una única capability, read-only, sin targetParam (opera sobre el host entero)", () => {
    const plugin = new DeviceDiscoveryPlugin(fakeService(async () => fakeResult()));

    const capabilities = plugin.getCapabilities("edge-agent-host");

    expect(capabilities).toHaveLength(1);
    expect(capabilities[0]).toMatchObject({ name: "scan_connected_devices", severity: "read-only" });
  });

  it("connect() dispara un escaneo en background sin esperarlo, y el resultado queda cacheado apenas termina", async () => {
    let scanResolved = false;
    const scan = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      scanResolved = true;
      return fakeResult();
    });
    const plugin = new DeviceDiscoveryPlugin(fakeService(scan));

    await plugin.connect("edge-agent-host");
    // connect() ya resolvió — si esperara el escaneo, esto sería true acá.
    expect(scanResolved).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(scanResolved).toBe(true);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("invoke() sin refresh, con un escaneo inicial ya cacheado, devuelve el resultado cacheado sin volver a escanear", async () => {
    const cached = fakeResult({ devices: [{ id: "d1", transport: "serial", name: "Arduino", confidence: "exact", raw: {} }] });
    const scan = vi.fn(async () => cached);
    const plugin = new DeviceDiscoveryPlugin(fakeService(scan));
    await plugin.connect("edge-agent-host");
    await new Promise((resolve) => setTimeout(resolve, 0)); // deja que el escaneo en background de connect() termine

    const result = await plugin.invoke("edge-agent-host", "scan_connected_devices", {});

    expect(result).toEqual({ success: true, data: cached });
    expect(scan).toHaveBeenCalledTimes(1); // solo el de connect(), invoke() no re-escaneó
  });

  it("invoke() con refresh:true siempre vuelve a escanear, aunque haya un resultado cacheado", async () => {
    const first = fakeResult({ durationMs: 1 });
    const second = fakeResult({ durationMs: 2 });
    const scan = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const plugin = new DeviceDiscoveryPlugin(fakeService(scan));
    await plugin.connect("edge-agent-host");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const result = await plugin.invoke("edge-agent-host", "scan_connected_devices", { refresh: true });

    expect(result).toEqual({ success: true, data: second });
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("invoke() sin nada cacheado todavía (connect() no corrió o sigue en vuelo) escanea de una", async () => {
    const result = fakeResult();
    const scan = vi.fn(async () => result);
    const plugin = new DeviceDiscoveryPlugin(fakeService(scan));

    const outcome = await plugin.invoke("edge-agent-host", "scan_connected_devices", {});

    expect(outcome).toEqual({ success: true, data: result });
  });

  it("rechaza una capability desconocida", async () => {
    const plugin = new DeviceDiscoveryPlugin(fakeService(async () => fakeResult()));

    const outcome = await plugin.invoke("edge-agent-host", "algo_inventado", {});

    expect(outcome.success).toBe(false);
  });
});
