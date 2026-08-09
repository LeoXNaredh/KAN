/**
 * Abstracción de una conexión Modbus (TCP, RTU sobre TCP, o RTU serial real)
 * a un target ya configurado (nunca uno arbitrario elegido en la
 * conversación — ver README). Igual que los demás *TransportPort de los
 * plugins hermanos: testeable sin red/hardware real con un fake (ver
 * infra/FakeModbusTransport.ts). La implementación real
 * (infra/NodeModbusTransport.ts) usa el paquete `modbus-serial`.
 */
export type ModbusTarget = { kind: "tcp"; host: string; port: number } | { kind: "rtu-serial"; path: string; baudRate: number };

export interface ModbusConnectOptions {
  connectTimeoutMs?: number;
}

export interface ModbusConnection {
  readHoldingRegisters(unitId: number, address: number, length: number): Promise<number[]>;
  readInputRegisters(unitId: number, address: number, length: number): Promise<number[]>;
  readCoils(unitId: number, address: number, length: number): Promise<boolean[]>;
  readDiscreteInputs(unitId: number, address: number, length: number): Promise<boolean[]>;
  writeRegister(unitId: number, address: number, value: number): Promise<void>;
  writeCoil(unitId: number, address: number, value: boolean): Promise<void>;
  close(): Promise<void>;
}

export interface ModbusTransportPort {
  connect(target: ModbusTarget, options?: ModbusConnectOptions): Promise<ModbusConnection>;
}
