import * as snmp from "net-snmp";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { NodeSnmpTransport } from "./NodeSnmpTransport";

/**
 * Contra un Agent SNMP real de `net-snmp` (no un mock del transporte),
 * mismo criterio ADR-012 que el resto de los *TransportPort.test.ts —
 * `net-snmp` trae soporte completo de agente, así que a diferencia de
 * Modbus RTU serial no hace falta simular nada a mano.
 */
describe("NodeSnmpTransport (integración real contra un Agent SNMP)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agent: any;
  const port = 16161;

  beforeAll(async () => {
    agent = snmp.createAgent({ port, accessControlModelType: snmp.AccessControlModelType.Simple }, () => {});
    const mib = agent.getMib();
    // Sin `handler` — mismo patrón que el ejemplo oficial del paquete
    // (example/snmp-agent.js): registrar el provider y fijar el valor
    // real con mib.setScalarValue(), no un handler custom por instancia.
    // maxAccess es obligatorio para que el agente conteste algo — sin él,
    // isAllowed() compara `undefined >= MaxAccess['read-only']`, que
    // siempre da false y el agente responde NoAccess a cualquier get/walk
    // (hallazgo real, encontrado leyendo Agent.prototype.isAllowed en el
    // código fuente del paquete, no en su documentación).
    mib.registerProvider({
      name: "sysDescr",
      type: snmp.MibProviderType.Scalar,
      oid: "1.3.6.1.2.1.1.1",
      scalarType: snmp.ObjectType.OctetString,
      maxAccess: snmp.MaxAccess["read-only"],
    });
    mib.registerProvider({
      name: "sysName",
      type: snmp.MibProviderType.Scalar,
      oid: "1.3.6.1.2.1.1.5",
      scalarType: snmp.ObjectType.OctetString,
      maxAccess: snmp.MaxAccess["read-only"],
    });
    mib.setScalarValue("sysDescr", "KAN test agent");
    mib.setScalarValue("sysName", "kan-test-host");

    // El control de acceso por comunidad aplica igual con
    // accessControlModelType: Simple — mismo patrón que
    // example/snmp-agent.js del paquete; sin esto, cualquier get/walk da
    // "NoAccess" aunque el provider ya tenga maxAccess correcto.
    const authorizer = agent.getAuthorizer();
    authorizer.addCommunity("public");
    authorizer.getAccessControlModel().setCommunityAccess("public", snmp.AccessLevel.ReadOnly);

    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterAll(() => {
    agent.close();
  });

  it("get() real trae el valor servido por el agente", async () => {
    const transport = new NodeSnmpTransport();
    const value = await transport.get("127.0.0.1", port, "public", "1.3.6.1.2.1.1.1.0");
    expect(value).toBe("KAN test agent");
  });

  it("walk() real recorre el subárbol y trae todos los valores registrados", async () => {
    const transport = new NodeSnmpTransport();
    const varbinds = await transport.walk("127.0.0.1", port, "public", "1.3.6.1.2.1.1");
    const values = varbinds.map((v) => v.value);
    expect(values).toContain("KAN test agent");
    expect(values).toContain("kan-test-host");
  });

  it("get() a un OID inexistente rechaza, no cuelga", async () => {
    const transport = new NodeSnmpTransport();
    await expect(transport.get("127.0.0.1", port, "public", "1.3.6.1.2.1.99.99.0", 1000)).rejects.toThrow();
  });

  it("get() contra un puerto sin agente escuchando rechaza (timeout), no cuelga", async () => {
    const transport = new NodeSnmpTransport();
    await expect(transport.get("127.0.0.1", 1, "public", "1.3.6.1.2.1.1.1.0", 500)).rejects.toThrow();
  });
});
