import { DataType, OPCUAServer, StatusCodes, Variant } from "node-opcua";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NodeOpcuaTransport } from "./NodeOpcuaTransport";

/**
 * Contra un OPCUAServer real de `node-opcua` (no un mock), mismo criterio
 * ADR-012 que el resto de los *TransportPort.test.ts — adaptado del
 * ejemplo oficial en la documentación de la propia clase OPCUAServer
 * (JSDoc de opcua_server.d.ts), extendido con una variable escribible
 * (bindVariable) para poder probar writeNode de verdad.
 */
describe("NodeOpcuaTransport (integración real contra un OPCUAServer real)", () => {
  let server: OPCUAServer;
  let endpointUrl: string;
  let writableValue = 10;

  beforeAll(async () => {
    // hostname explícito — sin esto, getFullyQualifiedDomainName() devuelve
    // algo que este entorno no resuelve y el endpoint queda con host
    // literal "undefined" (hallazgo real: "getaddrinfo ENOTFOUND undefined").
    server = new OPCUAServer({ port: 26543, hostname: "127.0.0.1" });
    await server.initialize();

    const addressSpace = server.engine.addressSpace!;
    const namespace = addressSpace.getOwnNamespace();

    const temperature = namespace.addVariable({
      browseName: "Temperature",
      organizedBy: addressSpace.rootFolder.objects,
      dataType: DataType.Double,
    });
    temperature.setValueFromSource(new Variant({ dataType: DataType.Double, value: 22.5 }));

    const setpoint = namespace.addVariable({
      browseName: "Setpoint",
      organizedBy: addressSpace.rootFolder.objects,
      dataType: DataType.Double,
      nodeId: "s=Setpoint",
    });
    setpoint.bindVariable({
      get: () => new Variant({ dataType: DataType.Double, value: writableValue }),
      set: (variant: Variant) => {
        writableValue = variant.value;
        return StatusCodes.Good;
      },
    });

    await server.start();
    endpointUrl = server.getEndpointUrl();
  });

  afterAll(async () => {
    await server.shutdown();
  });

  it("connect() real abre sesión anónima contra un servidor real", async () => {
    const transport = new NodeOpcuaTransport();
    const connection = await transport.connect({ endpointUrl });
    await connection.close();
  });

  it("readNode real trae el valor real fijado con setValueFromSource", async () => {
    const transport = new NodeOpcuaTransport();
    const connection = await transport.connect({ endpointUrl });

    const result = await connection.readNode("ns=1;s=Setpoint");
    expect(result.value).toBe(10);
    expect(result.statusCode).toBe("Good");

    await connection.close();
  });

  it("writeNode real persiste — confirmado con una lectura posterior real", async () => {
    const transport = new NodeOpcuaTransport();
    const connection = await transport.connect({ endpointUrl });

    await connection.writeNode("ns=1;s=Setpoint", 99.5, "Double");
    const result = await connection.readNode("ns=1;s=Setpoint");
    expect(result.value).toBe(99.5);

    await connection.close();
  });

  it("browseNode real lista los hijos reales del RootFolder/Objects", async () => {
    const transport = new NodeOpcuaTransport();
    const connection = await transport.connect({ endpointUrl });

    const rootEntries = await connection.browseNode("RootFolder");
    expect(rootEntries.map((e) => e.browseName)).toContain("Objects");

    const objectsEntry = rootEntries.find((e) => e.browseName === "Objects");
    const objectsChildren = await connection.browseNode(objectsEntry!.nodeId);
    const names = objectsChildren.map((e) => e.browseName);
    // "1:Temperature", no "Temperature" — node-opcua antepone el índice de
    // namespace en la representación de QualifiedName cuando no es el
    // namespace 0 (getOwnNamespace() acá es namespace 1). Confirmado con un
    // script de depuración directo contra el servidor real, no una
    // suposición.
    expect(names).toContain("1:Temperature");
    expect(names).toContain("1:Setpoint");

    await connection.close();
  });

  it("readNode sobre un nodo inexistente rechaza, no cuelga", async () => {
    const transport = new NodeOpcuaTransport();
    const connection = await transport.connect({ endpointUrl });

    await expect(connection.readNode("ns=1;s=NoExiste")).rejects.toThrow();

    await connection.close();
  });

  it("connect() a un endpoint sin nada escuchando rechaza, no cuelga", async () => {
    const transport = new NodeOpcuaTransport();
    await expect(transport.connect({ endpointUrl: "opc.tcp://127.0.0.1:1" }, { connectTimeoutMs: 2000 })).rejects.toThrow();
  }, 15000);
});
