import ModbusRTU from "modbus-serial";
import type { ModbusConnectOptions, ModbusConnection, ModbusTarget, ModbusTransportPort } from "../ModbusTransportPort";

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * `setID` antes de cada operación (no una vez al conectar) — soporta
 * multi-drop: un mismo gateway TCP-a-RTU o una misma línea serial RTU
 * puede tener varios unitId distintos detrás de una sola conexión, y cada
 * capability recibe su propio `unitId` por invocación.
 */
class ModbusSerialConnection implements ModbusConnection {
  constructor(private readonly client: ModbusRTU) {}

  async readHoldingRegisters(unitId: number, address: number, length: number): Promise<number[]> {
    this.client.setID(unitId);
    const result = await this.client.readHoldingRegisters(address, length);
    return result.data;
  }

  async readInputRegisters(unitId: number, address: number, length: number): Promise<number[]> {
    this.client.setID(unitId);
    const result = await this.client.readInputRegisters(address, length);
    return result.data;
  }

  async readCoils(unitId: number, address: number, length: number): Promise<boolean[]> {
    this.client.setID(unitId);
    const result = await this.client.readCoils(address, length);
    // El wire protocol empaqueta coils en bytes completos (8 bits) — el
    // cliente devuelve el byte entero, no solo los `length` bits pedidos.
    return result.data.slice(0, length);
  }

  async readDiscreteInputs(unitId: number, address: number, length: number): Promise<boolean[]> {
    this.client.setID(unitId);
    const result = await this.client.readDiscreteInputs(address, length);
    return result.data.slice(0, length);
  }

  async writeRegister(unitId: number, address: number, value: number): Promise<void> {
    this.client.setID(unitId);
    await this.client.writeRegister(address, value);
  }

  async writeCoil(unitId: number, address: number, value: boolean): Promise<void> {
    this.client.setID(unitId);
    await this.client.writeCoil(address, value);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export class NodeModbusTransport implements ModbusTransportPort {
  async connect(target: ModbusTarget, options?: ModbusConnectOptions): Promise<ModbusConnection> {
    const client = new ModbusRTU();
    client.setTimeout(options?.connectTimeoutMs ?? DEFAULT_TIMEOUT_MS);

    if (target.kind === "tcp") {
      await client.connectTCP(target.host, { port: target.port });
    } else {
      await client.connectRTUBuffered(target.path, { baudRate: target.baudRate });
    }

    return new ModbusSerialConnection(client);
  }
}
