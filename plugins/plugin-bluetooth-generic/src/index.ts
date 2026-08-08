import type { CapabilityResult, DeviceDescriptor, PluginManifest, TargetDescriptor } from "@kan/plugin-contract";
import { KanDeviceDriverPlugin, defineCapability, definePermissions } from "@kan/plugin-sdk-ts";
import type { BleConnection, BleDeviceInfo, BluetoothTransportPort } from "./BluetoothTransportPort";
import { FakeBluetoothTransport } from "./infra/FakeBluetoothTransport";

const ADAPTER_DEVICE_ID = "bluetooth-adapter";
const DEFAULT_SCAN_TIMEOUT_MS = 5000;
const HEX_PATTERN = /^[0-9a-fA-F]+$/;

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function validateAddress(input: unknown): ValidationResult<string> {
  const address = (input as { address?: unknown } | null)?.address;
  if (typeof address !== "string" || !address.trim()) return fail("'address' debe ser un string no vacío");
  return ok(address);
}

function validateUuids(input: unknown): ValidationResult<{ serviceUuid: string; characteristicUuid: string }> {
  const serviceUuid = (input as { serviceUuid?: unknown } | null)?.serviceUuid;
  const characteristicUuid = (input as { characteristicUuid?: unknown } | null)?.characteristicUuid;
  if (typeof serviceUuid !== "string" || !serviceUuid.trim()) {
    return fail("'serviceUuid' debe ser un string no vacío");
  }
  if (typeof characteristicUuid !== "string" || !characteristicUuid.trim()) {
    return fail("'characteristicUuid' debe ser un string no vacío");
  }
  return ok({ serviceUuid, characteristicUuid });
}

function validateHexValue(input: unknown): ValidationResult<Buffer> {
  const value = (input as { value?: unknown } | null)?.value;
  if (typeof value !== "string" || value.length === 0 || value.length % 2 !== 0 || !HEX_PATTERN.test(value)) {
    return fail('\'value\' debe ser un string hexadecimal de longitud par (ej. "01", "a1b2")');
  }
  return ok(Buffer.from(value, "hex"));
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Plugin genérico de Bluetooth (BLE central-mode) — nunca asume qué hay
 * conectado (regla 8 del sistema de Safety Policy, igual que
 * plugin-esp32-arduino): el "dispositivo" (DeviceDriverPort) es el
 * adaptador Bluetooth de la máquina; cada periférico BLE encontrado por
 * escaneo es un target direccionable por su `address` para
 * SafetyPolicyStore — mismo mecanismo que los pines del ESP32, sin tocar
 * esa infraestructura.
 *
 * Sin adaptador nativo probado en este entorno todavía — ver README.md
 * sobre el protocolo de fallback (FakeBluetoothTransport como default).
 */
export class BluetoothDevicePlugin extends KanDeviceDriverPlugin {
  readonly kind = "bluetooth-generic";

  readonly manifest: PluginManifest = {
    id: "kan-plugin-bluetooth-generic",
    version: "0.1.0",
    displayName: "Bluetooth (BLE genérico)",
    kind: "device-driver",
    runtime: "in-process-ts",
    permissions: definePermissions({ devices: ["bluetooth-generic"], network: false, filesystem: [] }),
  };

  private readonly connections = new Map<string, BleConnection>();
  private lastScan: BleDeviceInfo[] = [];

  constructor(private readonly transport: BluetoothTransportPort = new FakeBluetoothTransport([])) {
    super();
  }

  async discover(): Promise<DeviceDescriptor[]> {
    return [{ id: ADAPTER_DEVICE_ID, name: "Adaptador Bluetooth", kind: this.kind }];
  }

  async connect(deviceId: string): Promise<void> {
    if (deviceId !== ADAPTER_DEVICE_ID) throw new Error(`Dispositivo desconocido: ${deviceId}`);
  }

  async disconnect(deviceId: string): Promise<void> {
    if (deviceId !== ADAPTER_DEVICE_ID) return;
    for (const connection of this.connections.values()) {
      await connection.disconnect().catch(() => undefined);
    }
    this.connections.clear();
  }

  getCapabilities(_deviceId: string) {
    return [
      defineCapability({
        name: "scan_bluetooth_devices",
        description: "Escanea periféricos Bluetooth (BLE) cercanos.",
        severity: "read-only",
        supportsDryRun: false,
      }),
      defineCapability({
        name: "read_characteristic",
        description: "Lee una característica GATT de un periférico BLE.",
        severity: "read-only",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string" },
            serviceUuid: { type: "string" },
            characteristicUuid: { type: "string" },
          },
          required: ["address", "serviceUuid", "characteristicUuid"],
        },
        targetParam: "address",
      }),
      defineCapability({
        name: "write_characteristic",
        description: "Escribe una característica GATT de un periférico BLE (valor en hexadecimal).",
        severity: "irreversible-material",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string" },
            serviceUuid: { type: "string" },
            characteristicUuid: { type: "string" },
            value: { type: "string" },
          },
          required: ["address", "serviceUuid", "characteristicUuid", "value"],
        },
        targetParam: "address",
      }),
      defineCapability({
        name: "disconnect_bluetooth_device",
        description: "Desconecta un periférico BLE previamente conectado.",
        severity: "reversible",
        supportsDryRun: false,
        inputSchema: {
          type: "object",
          properties: { address: { type: "string" } },
          required: ["address"],
        },
        targetParam: "address",
      }),
    ];
  }

  listTargets(_deviceId: string): TargetDescriptor[] {
    return this.lastScan.map((device) => ({
      target: device.address,
      suggestedAlias: device.name,
      defaultSeverity: "irreversible-material",
    }));
  }

  async invoke(deviceId: string, capabilityName: string, input: unknown): Promise<CapabilityResult> {
    if (deviceId !== ADAPTER_DEVICE_ID) {
      return { success: false, error: `Dispositivo desconocido: ${deviceId}` };
    }

    switch (capabilityName) {
      case "scan_bluetooth_devices":
        try {
          this.lastScan = await this.transport.scan(DEFAULT_SCAN_TIMEOUT_MS);
          return { success: true, data: { devices: this.lastScan } };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }

      case "read_characteristic": {
        const address = validateAddress(input);
        if (!address.ok) return { success: false, error: address.error };
        const uuids = validateUuids(input);
        if (!uuids.ok) return { success: false, error: uuids.error };

        try {
          const connection = await this.connectionFor(address.value);
          const value = await connection.readCharacteristic(uuids.value.serviceUuid, uuids.value.characteristicUuid);
          return { success: true, data: { value: value.toString("hex") } };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "write_characteristic": {
        const address = validateAddress(input);
        if (!address.ok) return { success: false, error: address.error };
        const uuids = validateUuids(input);
        if (!uuids.ok) return { success: false, error: uuids.error };
        const value = validateHexValue(input);
        if (!value.ok) return { success: false, error: value.error };

        try {
          const connection = await this.connectionFor(address.value);
          await connection.writeCharacteristic(uuids.value.serviceUuid, uuids.value.characteristicUuid, value.value);
          return { success: true, data: {} };
        } catch (error) {
          return { success: false, error: toMessage(error) };
        }
      }

      case "disconnect_bluetooth_device": {
        const address = validateAddress(input);
        if (!address.ok) return { success: false, error: address.error };

        const connection = this.connections.get(address.value);
        if (!connection) return { success: true, data: {} };
        await connection.disconnect();
        this.connections.delete(address.value);
        return { success: true, data: {} };
      }

      default:
        return { success: false, error: `Capability desconocida: ${capabilityName}` };
    }
  }

  private async connectionFor(address: string): Promise<BleConnection> {
    const existing = this.connections.get(address);
    if (existing) return existing;
    const connection = await this.transport.connect(address);
    this.connections.set(address, connection);
    return connection;
  }
}

export type { BleConnection, BleDeviceInfo, BluetoothTransportPort } from "./BluetoothTransportPort";
export { FakeBluetoothTransport, type FakeBleDevice } from "./infra/FakeBluetoothTransport";
