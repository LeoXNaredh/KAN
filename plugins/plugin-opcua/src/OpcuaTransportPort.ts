/**
 * Abstracción de una sesión OPC-UA (leer/escribir/navegar nodos) contra un
 * endpoint ya configurado (nunca uno elegido en la conversación — ver
 * README). Igual que los demás *TransportPort de los plugins hermanos:
 * testeable sin red real con un fake (ver infra/FakeOpcuaTransport.ts). La
 * implementación real (infra/NodeOpcuaTransport.ts) usa el paquete
 * `node-opcua`.
 */
export type OpcuaValueType = "Double" | "Float" | "Int32" | "UInt32" | "Boolean" | "String";

export interface OpcuaCredentials {
  username: string;
  password: string;
}

export interface OpcuaTarget {
  endpointUrl: string;
  credentials?: OpcuaCredentials;
}

export interface OpcuaNodeValue {
  value: unknown;
  dataType: string;
  statusCode: string;
}

export interface OpcuaBrowseEntry {
  nodeId: string;
  browseName: string;
  nodeClass: string;
}

export interface OpcuaConnection {
  readNode(nodeId: string): Promise<OpcuaNodeValue>;
  writeNode(nodeId: string, value: unknown, dataType: OpcuaValueType): Promise<void>;
  browseNode(nodeId: string): Promise<OpcuaBrowseEntry[]>;
  close(): Promise<void>;
}

export interface OpcuaConnectOptions {
  connectTimeoutMs?: number;
}

export interface OpcuaTransportPort {
  connect(target: OpcuaTarget, options?: OpcuaConnectOptions): Promise<OpcuaConnection>;
}
