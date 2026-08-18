import type { CapabilityResult, DeviceDescriptor, PluginManifest } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { DeviceDiscoveryService } from "./DeviceDiscoveryService";
import type { DiscoveredDevice, DiscoveryResult } from "../domain/entities/DiscoveredDevice";

const DEVICE_ID = "edge-agent-host";
const CAPABILITY_NAME = "scan_connected_devices";
/** `kind` de los pseudo-dispositivos seriales auto-registrados por detección en caliente — ver discover(). */
const PERIPHERAL_KIND = "discovered-serial";

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
 *
 * Detección en caliente (ADR-060 incremento 2): `discover()` se llama
 * repetidas veces (`EdgeAgent.rediscoverDriver`, sondeado cada pocos
 * segundos desde `apps/desktop`) y en cada llamada agrega un pseudo-
 * dispositivo por cada periférico serial visible — DeviceManager ya es
 * idempotente (ver discoverDriver()), así que uno ya conocido no se
 * reprocesa. Solo serial: enumerar puertos es casi instantáneo (consulta
 * local al SO); WiFi/BLE necesitan esperar respuestas (10-15s) y quedan
 * fuera del polling frecuente, solo en el scan() completo bajo demanda vía
 * la capability. Estos pseudo-dispositivos son puramente informativos — sin
 * capabilities propias (getCapabilities() devuelve []): son "esto existe",
 * no "esto es controlable" (mismo principio que documenta DiscoveredDevice).
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
    const host: DeviceDescriptor = { id: DEVICE_ID, name: "Detección de dispositivos", kind: this.kind };
    let serial: DiscoveredDevice[] = [];
    try {
      serial = await this.service.scanSerial();
    } catch {
      // Best-effort, mismo criterio que scan(): un fallo de enumeración
      // serial no debe tumbar discover() ni el resto del polling.
    }
    const peripherals: DeviceDescriptor[] = serial.map((device) => ({
      id: device.id,
      name: device.name,
      kind: PERIPHERAL_KIND,
      transport: device.transport,
      address: device.port,
    }));
    return [host, ...peripherals];
  }

  async connect(deviceId: string): Promise<void> {
    if (deviceId !== DEVICE_ID) return; // pseudo-dispositivo serial: nada que abrir, ver clase.

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

  getCapabilities(deviceId: string) {
    if (deviceId !== DEVICE_ID) return []; // pseudo-dispositivo serial: informativo, sin capabilities propias.

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
