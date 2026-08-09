import type {
  SshConnectOptions,
  SshConnection,
  SshCommandResult,
  SshDirectoryEntry,
  SshTarget,
  SshTransportPort,
} from "../SshTransportPort";

export interface FakeSshHostConfig {
  /** Si es `false`, connect() a este host falla (simula un host inalcanzable/rechazo de auth). */
  reachable?: boolean;
  commandHandler?: (command: string) => SshCommandResult;
  files?: Record<string, string>;
  directories?: Record<string, SshDirectoryEntry[]>;
}

function keyOf(host: string, port: number): string {
  return `${host}:${port}`;
}

/**
 * Host SSH simulado en memoria para tests del plugin — nunca usado para
 * probar el transporte real, eso lo cubre NodeSshTransport.test.ts contra
 * un Server real de `ssh2` con exec y un subsistema SFTP real respaldado
 * por un directorio temporal en disco (ADR-012).
 */
export class FakeSshTransport implements SshTransportPort {
  constructor(private readonly hosts: Record<string, FakeSshHostConfig> = {}) {}

  async connect(target: SshTarget, _options?: SshConnectOptions): Promise<SshConnection> {
    const key = keyOf(target.host, target.port);
    if (this.hosts[key]?.reachable === false) throw new Error(`No se pudo conectar a ${key}`);

    const config = this.hosts[key] ?? {};
    const files = { ...(config.files ?? {}) };

    return {
      executeCommand: async (command: string) => {
        if (config.commandHandler) return config.commandHandler(command);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      readFile: async (path: string) => {
        const content = files[path];
        if (content === undefined) throw new Error(`No such file: ${path}`);
        return content;
      },
      writeFile: async (path: string, content: string) => {
        files[path] = content;
      },
      listDirectory: async (path: string) => {
        const entries = config.directories?.[path];
        if (!entries) throw new Error(`No such directory: ${path}`);
        return entries;
      },
      close: async () => {},
    };
  }
}
