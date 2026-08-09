import { AttributeIds, DataType, OPCUAClient, UserTokenType, Variant, type ClientSession } from "node-opcua";
import type {
  OpcuaBrowseEntry,
  OpcuaConnectOptions,
  OpcuaConnection,
  OpcuaNodeValue,
  OpcuaTarget,
  OpcuaTransportPort,
  OpcuaValueType,
} from "../OpcuaTransportPort";

const DEFAULT_TIMEOUT_MS = 10000;

const DATA_TYPE_MAP: Record<OpcuaValueType, DataType> = {
  Double: DataType.Double,
  Float: DataType.Float,
  Int32: DataType.Int32,
  UInt32: DataType.UInt32,
  Boolean: DataType.Boolean,
  String: DataType.String,
};

class OpcuaSessionConnection implements OpcuaConnection {
  constructor(
    private readonly client: OPCUAClient,
    private readonly session: ClientSession,
  ) {}

  async readNode(nodeId: string): Promise<OpcuaNodeValue> {
    const dataValue = await this.session.read({ nodeId, attributeId: AttributeIds.Value });
    // read() nunca rechaza a nivel de transporte para un nodeId inválido —
    // siempre "resuelve" con un statusCode por nodo (ej. BadNodeIdUnknown).
    // Sin este chequeo, un nodeId con typo se leería en silencio como
    // {value: null}, no como un error.
    if (!dataValue.statusCode.isGood()) {
      throw new Error(`Lectura OPC-UA falló: ${dataValue.statusCode.name}`);
    }
    return {
      value: dataValue.value?.value,
      dataType: dataValue.value?.dataType !== undefined ? DataType[dataValue.value.dataType] : "Unknown",
      statusCode: dataValue.statusCode.name,
    };
  }

  async writeNode(nodeId: string, value: unknown, dataType: OpcuaValueType): Promise<void> {
    const statusCode = await this.session.write({
      nodeId,
      attributeId: AttributeIds.Value,
      value: { value: new Variant({ dataType: DATA_TYPE_MAP[dataType], value }) },
    });
    if (statusCode.value !== 0) throw new Error(`Escritura OPC-UA falló: ${statusCode.name}`);
  }

  async browseNode(nodeId: string): Promise<OpcuaBrowseEntry[]> {
    const result = await this.session.browse(nodeId);
    return (result.references ?? []).map((ref) => ({
      nodeId: ref.nodeId.toString(),
      browseName: ref.browseName.toString(),
      nodeClass: ref.nodeClass?.toString() ?? "Unknown",
    }));
  }

  async close(): Promise<void> {
    await this.session.close();
    await this.client.disconnect();
  }
}

export class NodeOpcuaTransport implements OpcuaTransportPort {
  async connect(target: OpcuaTarget, options?: OpcuaConnectOptions): Promise<OpcuaConnection> {
    const client = OPCUAClient.create({
      endpointMustExist: false,
      connectionStrategy: { maxRetry: 0 },
      requestedSessionTimeout: options?.connectTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    try {
      await client.connect(target.endpointUrl);
      const session = target.credentials
        ? await client.createSession({ type: UserTokenType.UserName, userName: target.credentials.username, password: target.credentials.password })
        : await client.createSession();
      return new OpcuaSessionConnection(client, session);
    } catch (error) {
      await client.disconnect().catch(() => {});
      throw error;
    }
  }
}
