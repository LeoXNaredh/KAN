import type { KanDeviceDriverPlugin } from "@kan/plugin-sdk-ts";
import type { Device } from "../domain/entities/Device";
import type { LoggerPort } from "../domain/ports/LoggerPort";
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

  constructor(
    private readonly bus: EdgeAgentBus,
    private readonly logger: LoggerPort,
  ) {}

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
      await driver.connect(descriptor.id);
      const device: Device = {
        id: descriptor.id,
        name: descriptor.name,
        kind: descriptor.kind,
        pluginId: driver.id,
        status: "connected",
        capabilities: driver.getCapabilities(descriptor.id),
      };
      this.devices.set(device.id, device);
      this.driverByDeviceId.set(device.id, driver);
      devices.push(device);
      this.logger.info(`Dispositivo conectado: ${device.name} (${device.id})`);
      this.bus.emit("device.connected", { device });
    }
    return devices;
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
