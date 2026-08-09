import type { ModbusConnectOptions, ModbusConnection, ModbusTarget, ModbusTransportPort } from "../ModbusTransportPort";

export interface FakeModbusUnitRegisters {
  holding?: Record<number, number>;
  input?: Record<number, number>;
  coils?: Record<number, boolean>;
  discrete?: Record<number, boolean>;
}

export interface FakeModbusTargetConfig {
  /** Si es `false`, connect() a este target falla (simula un target inalcanzable). */
  reachable?: boolean;
  unitRegisters?: Record<number, FakeModbusUnitRegisters>;
}

function targetKey(target: ModbusTarget): string {
  if (target.kind === "rtu-serial") return `${target.kind}:${target.path}`;
  return `${target.kind}:${target.host}:${target.port}`;
}

/**
 * Dispositivo Modbus simulado en memoria para tests del plugin (mismo rol
 * que FakeMqttTransport/FakeHttpTransport) — nunca usado para probar el
 * transporte real, eso lo cubre NodeModbusTransport.test.ts contra un
 * ServerTCP real (TCP) y un responder RTU-sobre-TCP con CRC16 real
 * (ADR-012).
 */
export class FakeModbusTransport implements ModbusTransportPort {
  constructor(private readonly targets: Record<string, FakeModbusTargetConfig> = {}) {}

  async connect(target: ModbusTarget, _options?: ModbusConnectOptions): Promise<ModbusConnection> {
    const key = targetKey(target);
    const config = this.targets[key];
    if (config?.reachable === false) throw new Error(`No se pudo conectar a ${key}`);

    const unitRegisters = config?.unitRegisters ?? {};

    return {
      readHoldingRegisters: async (unitId, address, length) => {
        const map = unitRegisters[unitId]?.holding ?? {};
        return Array.from({ length }, (_, i) => map[address + i] ?? 0);
      },
      readInputRegisters: async (unitId, address, length) => {
        const map = unitRegisters[unitId]?.input ?? {};
        return Array.from({ length }, (_, i) => map[address + i] ?? 0);
      },
      readCoils: async (unitId, address, length) => {
        const map = unitRegisters[unitId]?.coils ?? {};
        return Array.from({ length }, (_, i) => map[address + i] ?? false);
      },
      readDiscreteInputs: async (unitId, address, length) => {
        const map = unitRegisters[unitId]?.discrete ?? {};
        return Array.from({ length }, (_, i) => map[address + i] ?? false);
      },
      writeRegister: async (unitId, address, value) => {
        const unit = (unitRegisters[unitId] ??= {});
        (unit.holding ??= {})[address] = value;
      },
      writeCoil: async (unitId, address, value) => {
        const unit = (unitRegisters[unitId] ??= {});
        (unit.coils ??= {})[address] = value;
      },
      close: async () => {},
    };
  }
}
