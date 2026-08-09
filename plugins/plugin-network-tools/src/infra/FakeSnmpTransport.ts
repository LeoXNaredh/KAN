import type { SnmpTransportPort, SnmpVarbind } from "../SnmpTransportPort";

export interface FakeSnmpDeviceConfig {
  /** Si es `false`, get()/walk() a este target fallan (simula un agente inalcanzable). */
  reachable?: boolean;
  oids?: Record<string, string>;
}

function keyOf(host: string, port: number): string {
  return `${host}:${port}`;
}

/**
 * Agente SNMP simulado en memoria para tests del plugin — nunca usado para
 * probar el transporte real, eso lo cubre NodeSnmpTransport.test.ts contra
 * un Agent real de `net-snmp` (ADR-012).
 */
export class FakeSnmpTransport implements SnmpTransportPort {
  constructor(private readonly devices: Record<string, FakeSnmpDeviceConfig> = {}) {}

  async get(host: string, port: number, _community: string, oid: string): Promise<string> {
    const key = keyOf(host, port);
    if (this.devices[key]?.reachable === false) throw new Error(`Timeout SNMP: ${key}`);
    const value = this.devices[key]?.oids?.[oid];
    if (value === undefined) throw new Error(`OID no encontrado: ${oid}`);
    return value;
  }

  async walk(host: string, port: number, _community: string, oid: string): Promise<SnmpVarbind[]> {
    const key = keyOf(host, port);
    if (this.devices[key]?.reachable === false) throw new Error(`Timeout SNMP: ${key}`);
    const oids = this.devices[key]?.oids ?? {};
    return Object.entries(oids)
      .filter(([candidateOid]) => candidateOid.startsWith(oid))
      .map(([candidateOid, value]) => ({ oid: candidateOid, value }));
  }
}
