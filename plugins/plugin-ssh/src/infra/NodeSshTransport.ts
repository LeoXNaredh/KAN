import { readFileSync } from "node:fs";
import { Client } from "ssh2";
import type { SshAuth, SshConnectOptions, SshConnection, SshCommandResult, SshDirectoryEntry, SshTarget, SshTransportPort } from "../SshTransportPort";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

function authOptions(auth: SshAuth): { password?: string; privateKey?: Buffer; passphrase?: string } {
  if (auth.kind === "password") return { password: auth.value };
  return { privateKey: readFileSync(auth.value), passphrase: auth.passphrase };
}

class Ssh2Connection implements SshConnection {
  constructor(private readonly client: Client) {}

  executeCommand(command: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<SshCommandResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Comando SSH agotó el tiempo de espera")), timeoutMs);

      this.client.exec(command, (error, stream) => {
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
        });
        stream.on("close", (exitCode: number | null) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode });
        });
        stream.on("error", (streamError: Error) => {
          clearTimeout(timer);
          reject(streamError);
        });
      });
    });
  }

  readFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }
        sftp.readFile(path, (readError, data) => {
          if (readError) reject(readError);
          else resolve(data.toString("utf8"));
        });
      });
    });
  }

  writeFile(path: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }
        sftp.writeFile(path, content, (writeError) => (writeError ? reject(writeError) : resolve()));
      });
    });
  }

  listDirectory(path: string): Promise<SshDirectoryEntry[]> {
    return new Promise((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }
        sftp.readdir(path, (readdirError, list) => {
          if (readdirError) {
            reject(readdirError);
            return;
          }
          resolve(list.map((entry) => ({ name: entry.filename, isDirectory: entry.attrs.isDirectory() })));
        });
      });
    });
  }

  async close(): Promise<void> {
    this.client.end();
  }
}

export class NodeSshTransport implements SshTransportPort {
  connect(target: SshTarget, options?: SshConnectOptions): Promise<SshConnection> {
    return new Promise((resolve, reject) => {
      const client = new Client();

      let settled = false;

      // Permanente desde el arranque, no `.once` — mismo cuidado que
      // NodeMqttTransport/NodeWsTransport: un EventEmitter sin listener de
      // "error" tumba el proceso.
      client.on("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });

      client.on("ready", () => {
        if (settled) return;
        settled = true;
        resolve(new Ssh2Connection(client));
      });

      client.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        readyTimeout: options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        ...authOptions(target.auth),
      });
    });
  }
}
