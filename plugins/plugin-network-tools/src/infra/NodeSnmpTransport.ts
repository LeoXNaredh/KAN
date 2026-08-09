import * as snmp from "net-snmp";
import type { SnmpTransportPort, SnmpVarbind } from "../SnmpTransportPort";

const DEFAULT_TIMEOUT_MS = 5000;
const WALK_MAX_REPETITIONS = 20;

export class NodeSnmpTransport implements SnmpTransportPort {
  async get(host: string, port: number, community: string, oid: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
    const session = snmp.createSession(host, community, { port, timeout: timeoutMs, version: snmp.Version2c });
    try {
      return await new Promise<string>((resolve, reject) => {
        session.get([oid], (error, varbinds) => {
          if (error) {
            reject(error);
            return;
          }
          const varbind = varbinds?.[0];
          if (!varbind) {
            reject(new Error("SNMP no devolvió ningún varbind"));
            return;
          }
          if (snmp.isVarbindError(varbind)) {
            reject(new Error(snmp.varbindError(varbind)));
            return;
          }
          resolve(String(varbind.value));
        });
      });
    } finally {
      session.close();
    }
  }

  async walk(host: string, port: number, community: string, oid: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<SnmpVarbind[]> {
    const session = snmp.createSession(host, community, { port, timeout: timeoutMs, version: snmp.Version2c });
    const results: SnmpVarbind[] = [];
    try {
      await new Promise<void>((resolve, reject) => {
        session.walk(
          oid,
          WALK_MAX_REPETITIONS,
          (varbinds) => {
            for (const varbind of varbinds) {
              if (!snmp.isVarbindError(varbind)) results.push({ oid: varbind.oid, value: String(varbind.value) });
            }
          },
          (error) => (error ? reject(error) : resolve()),
        );
      });
      return results;
    } finally {
      session.close();
    }
  }
}
