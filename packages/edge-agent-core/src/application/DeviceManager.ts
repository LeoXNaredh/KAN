import type { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import type { DeviceDescriptor } from "@kan/plugin-contract";
import type { Device } from "../domain/entities/Device";
import type { KnownDeviceRecord } from "../domain/entities/KnownDevice";
import type { LoggerPort } from "../domain/ports/LoggerPort";
import type { DeviceStorePort } from "../domain/ports/DeviceStorePort";
import type { EdgeAgentBus } from "./EdgeAgentBus";

/**
 * Registro de dispositivos conectados (requisito 4) y descubrimiento
 * automático (requisito 9): pregunta a cada driver habilitado por sus
 * dispositivos vía `discover()`, sin conocer el protocolo real detrás de
 * cada uno (Serial/USB/red/simulado — requisito 10).
 */
export class DeviceManager {
  private readonly devices = new Map<string, Device>();
  private readonly driverByDeviceId = new Map<string, KanDeviceDriverPlugin>();
  /**
   * Memoria de dispositivos entre reinicios — separada a propósito de
   * `devices` (arriba): esta sobrevive un reinicio de la app y puede
   * contener entradas de dispositivos que ahora mismo no están conectados;
   * `devices` es siempre el estado en vivo de esta sesión. Nunca se usa
   * para el guard de idempotencia de `discoverDriver()` — precargarla ahí
   * haría que un dispositivo ya visto (pero desconectado esta sesión) nunca
   * se vuelva a conectar de verdad al reaparecer.
   */
  private readonly knownDevices = new Map<string, KnownDeviceRecord>();

  constructor(
    private readonly bus: EdgeAgentBus,
    private readonly logger: LoggerPort,
    private readonly deviceStore?: DeviceStorePort,
  ) {
    for (const record of this.deviceStore?.load() ?? []) {
      this.knownDevices.set(record.id, record);
    }
  }

  async discoverAll(drivers: KanDeviceDriverPlugin[]): Promise<Device[]> {
    // El descubrimiento de cada driver es independiente — se paraleliza entre
    // drivers (no entre dispositivos de un mismo driver, que sí pueden
    // compartir recursos internos) para que arrancar con varios drivers
    // reales no escale linealmente con su número (hallazgo M12 de docs/13).
    const perDriver = await Promise.all(drivers.map((driver) => this.discoverDriver(driver)));
    return perDriver.flat();
  }

  private async discoverDriver(driver: KanDeviceDriverPlugin): Promise<Device[]> {
    const descriptors = await driver.discover();
    const devices: Device[] = [];
    for (const descriptor of descriptors) {
      // Idempotente (necesario para re-descubrimiento periódico — detección
      // en caliente, ADR-060 incremento 2): un driver cuyo discover() puede
      // llamarse repetidas veces (ej. DeviceDiscoveryPlugin, sondeado cada
      // pocos segundos) reportaría el mismo dispositivo ya conectado en cada
      // tick — sin este guard, se reconectaría/reloguearía/reemitiría de
      // nuevo cada vez en lugar de no hacer nada.
      if (this.devices.has(descriptor.id)) continue;
      await driver.connect(descriptor.id);
      const device: Device = {
        id: descriptor.id,
        name: descriptor.name,
        kind: descriptor.kind,
        pluginId: driver.id,
        status: "connected",
        capabilities: driver.getCapabilities(descriptor.id),
        transport: descriptor.transport,
        address: descriptor.address,
      };
      this.devices.set(device.id, device);
      this.driverByDeviceId.set(device.id, driver);
      devices.push(device);
      this.logger.info(`Dispositivo conectado: ${device.name} (${device.id})`);
      this.bus.emit("device.connected", { device });
      this.rememberDevice(descriptor);
    }
    return devices;
  }

  /** Persiste/actualiza la memoria de dispositivos (ver `knownDevices`) — no-op sin `deviceStore` (ej. tests, host de navegador). */
  private rememberDevice(descriptor: DeviceDescriptor): void {
    if (!this.deviceStore) return;
    this.knownDevices.set(descriptor.id, {
      id: descriptor.id,
      name: descriptor.name,
      transport: descriptor.transport,
      address: descriptor.address,
      lastSeenAt: new Date().toISOString(),
    });
    this.deviceStore.save(Array.from(this.knownDevices.values()));
  }

  /** Dispositivos vistos alguna vez, incluyendo los desconectados ahora mismo — sobrevive un reinicio del Edge Agent. */
  listKnown(): KnownDeviceRecord[] {
    return Array.from(this.knownDevices.values());
  }

  async disconnect(deviceId: string): Promise<void> {
    const driver = this.driverByDeviceId.get(deviceId);
    const device = this.devices.get(deviceId);
    if (!driver || !device) return;
    await driver.disconnect(deviceId);
    device.status = "disconnected";
    this.logger.info(`Dispositivo desconectado: ${device.name} (${deviceId})`);
    this.bus.emit("device.disconnected", { deviceId });
  }

  list(): Device[] {
    return Array.from(this.devices.values());
  }

  getDevice(deviceId: string): Device | undefined {
    return this.devices.get(deviceId);
  }

  getDriverFor(deviceId: string): KanDeviceDriverPlugin | undefined {
    return this.driverByDeviceId.get(deviceId);
  }
}
