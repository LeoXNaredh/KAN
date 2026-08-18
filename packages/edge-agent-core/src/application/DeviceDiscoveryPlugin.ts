import type { CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { DeviceDiscoveryService } from "./DeviceDiscoveryService";
import type { DiscoveryResult } from "../domain/entities/DiscoveredDevice";

const DEVICE_ID = "edge-agent-host";
const CAPABILITY_NAME = "scan_connected_devices";

/**
 * Expone `DeviceDiscoveryService` como una capability normal (ADR-060) —
 * mismo mecanismo que `discover_io_map` (ADR-058): el resultado llega al LLM
 * vía tool-result en la próxima ronda, nunca inyectado directo en un system
 * prompt — ese vive en `apps/web`, en otro proceso/máquina; el Edge Agent no
 * tiene ningún canal hacia él salvo el pipeline de capabilities ya existente.
 *
 * "Dispositivo" acá es el propio host del Edge Agent, no algo controlable —
 * `connect()`/`disconnect()` no abren ninguna conexión real, solo marcan el
 * punto donde dispara el escaneo inicial silencioso (mismo criterio
 * best-effort/en background que `DeviceEnrichmentService.enrichIfNew()`,
 * ADR-053: nunca bloquea el arranque).
 */
export class DeviceDiscoveryPlugin extends KanDeviceDriverPlugin {
  readonly kind = "device-discovery";

  readonly manifest: PluginManifest = {
    id: "kan-device-discovery",
    version: "0.1.0",
    displayName: "Detección de dispositivos conectados",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({
      devices: ["device-discovery"],
      network: true,
      filesystem: ["read:vid-pid-custom-catalog"],
    }),
  };

  private lastResult: DiscoveryResult | undefined;

  constructor(private readonly service: DeviceDiscoveryService) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    return [{ id: DEVICE_ID, name: "Detección de dispositivos", kind: this.kind }];
  }

  async connect(_deviceId: string): Promise<void> {
    void this.service
      .scan()
      .then((result) => {
        this.lastResult = result;
      })
      .catch(() => {
        // DeviceDiscoveryService ya absorbe el fallo de cada transporte por
        // separado — esto solo cubre un error inesperado de scan() en sí,
        // que no debería llegar a pasar.
      });
  }

  async disconnect(_deviceId: string): Promise<void> {}

  getCapabilities(_deviceId: string) {
    return [
      defineCapability({
        name: CAPABILITY_NAME,
        description:
          "Detecta dispositivos físicos conectados por serial, WiFi (mDNS) y Bluetooth BLE. Sin 'refresh', devuelve el último escaneo (rápido, ya corrido al conectar); con refresh:true, escanea de nuevo (~15s).",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: { type: "object", properties: { refresh: { type: "boolean" } } },
      }),
    ];
  }

  async invoke(_deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (capabilityName !== CAPABILITY_NAME) {
      return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }

    const refresh = (input as { refresh?: unknown } | null)?.refresh === true;
    if (!refresh && this.lastResult) {
      return { success: true, data: this.lastResult };
    }

    const result = await this.service.scan();
    this.lastResult = result;
    return { success: true, data: result };
  }
}
