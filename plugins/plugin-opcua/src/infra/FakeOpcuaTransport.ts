import type {
  OpcuaBrowseEntry,
  OpcuaConnectOptions,
  OpcuaConnection,
  OpcuaNodeValue,
  OpcuaTarget,
  OpcuaTransportPort,
  OpcuaValueType,
} from "../OpcuaTransportPort";

export interface FakeOpcuaEndpointConfig {
  /** Si es `false`, connect() a este endpoint falla (simula un servidor inalcanzable). */
  reachable?: boolean;
  nodes?: Record<string, { value: unknown; dataType: string }>;
  browseChildren?: Record<string, OpcuaBrowseEntry[]>;
}

/**
 * Servidor OPC-UA simulado en memoria para tests del plugin — nunca usado
 * para probar el transporte real, eso lo cubre NodeOpcuaTransport.test.ts
 * contra un OPCUAServer real de `node-opcua` (ADR-012).
 */
export class FakeOpcuaTransport implements OpcuaTransportPort {
  constructor(private readonly endpoints: Record<string, FakeOpcuaEndpointConfig> = {}) {}

  async connect(target: OpcuaTarget, _options?: OpcuaConnectOptions): Promise<OpcuaConnection> {
    if (this.endpoints[target.endpointUrl]?.reachable === false) {
      throw new Error(`No se pudo conectar a ${target.endpointUrl}`);
    }

    const config = this.endpoints[target.endpointUrl] ?? {};
    const nodes = { ...(config.nodes ?? {}) };

    return {
      readNode: async (nodeId: string): Promise<OpcuaNodeValue> => {
        const node = nodes[nodeId];
        if (!node) throw new Error(`Nodo desconocido: ${nodeId}`);
        return { value: node.value, dataType: node.dataType, statusCode: "Good" };
      },
      writeNode: async (nodeId: string, value: unknown, dataType: OpcuaValueType): Promise<void> => {
        nodes[nodeId] = { value, dataType };
      },
      browseNode: async (nodeId: string): Promise<OpcuaBrowseEntry[]> => {
        return config.browseChildren?.[nodeId] ?? [];
      },
      close: async () => {},
    };
  }
}
