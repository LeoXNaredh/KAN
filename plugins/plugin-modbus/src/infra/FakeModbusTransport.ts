import type { ModbusConnectOptions, ModbusConnection, ModbusTarget, ModbusTransportPort } from "../ModbusTransportPort";

export interface FakeModbusUnitRegisters {
  holding?: Record<number, number>;
  input?: Record<number, number>;
  coils?: Record<number, boolean>;
  discrete?: Record<number, boolean>;
  /**
   * Direcciones que simulan una excepción Modbus (ej. ILLEGAL_DATA_ADDRESS)
   * al leerse — para testear `discover_io_map` cuando un rango pedido cae
   * parcial o totalmente fuera del address space real del dispositivo. Un
   * read real es todo-o-nada por PDU: si cualquier dirección del rango
   * pedido está acá, la lectura entera del rango rechaza.
   */
  unreachableAddresses?: { holding?: number[]; input?: number[]; coils?: number[]; discrete?: number[] };
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

    function assertRangeReachable(unitId: number, kind: keyof NonNullable<FakeModbusUnitRegisters["unreachableAddresses"]>, address: number, length: number): void {
      const unreachable = unitRegisters[unitId]?.unreachableAddresses?.[kind] ?? [];
      const hit = unreachable.find((addr) => addr >= address && addr < address + length);
      if (hit !== undefined) throw new Error(`Excepción Modbus: dirección ${hit} fuera de rango (unidad ${unitId})`);
    }

    return {
      readHoldingRegisters: async (unitId, address, length) => {
        assertRangeReachable(unitId, "holding", address, length);
        const map = unitRegisters[unitId]?.holding ?? {};
        return Array.from({ length }, (_, i) => map[address + i] ?? 0);
      },
      readInputRegisters: async (unitId, address, length) => {
        assertRangeReachable(unitId, "input", address, length);
        const map = unitRegisters[unitId]?.input ?? {};
        return Array.from({ length }, (_, i) => map[address + i] ?? 0);
      },
      readCoils: async (unitId, address, length) => {
        assertRangeReachable(unitId, "coils", address, length);
        const map = unitRegisters[unitId]?.coils ?? {};
        return Array.from({ length }, (_, i) => map[address + i] ?? false);
      },
      readDiscreteInputs: async (unitId, address, length) => {
        assertRangeReachable(unitId, "discrete", address, length);
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
