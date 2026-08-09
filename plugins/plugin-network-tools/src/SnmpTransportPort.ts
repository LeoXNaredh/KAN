/**
 * Abstracción de un cliente SNMP (get/walk) contra un agente ya
 * configurado (nunca uno elegido en la conversación — ver README). Igual
 * que los demás *TransportPort de los plugins hermanos: testeable sin red
 * real con un fake (ver infra/FakeSnmpTransport.ts). La implementación
 * real (infra/NodeSnmpTransport.ts) usa el paquete `net-snmp` (SNMPv2c).
 */
export interface SnmpVarbind {
  oid: string;
  value: string;
}

export interface SnmpTransportPort {
  get(host: string, port: number, community: string, oid: string, timeoutMs?: number): Promise<string>;
  walk(host: string, port: number, community: string, oid: string, timeoutMs?: number): Promise<SnmpVarbind[]>;
}
