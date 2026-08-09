/**
 * Abstracción de una conexión SSH (comandos + SFTP) a un host ya
 * configurado (nunca uno elegido en la conversación — ver README, esta es
 * la superficie de riesgo más grande de todo el mapa de hardware).
 * Testeable sin red real con un fake (ver infra/FakeSshTransport.ts). La
 * implementación real (infra/NodeSshTransport.ts) usa el paquete `ssh2`.
 */
export interface SshAuth {
  kind: "key" | "password";
  /** Path al archivo de clave privada si kind es "key"; la password en texto plano si kind es "password". */
  value: string;
  /** Passphrase de la clave privada, si está cifrada. Solo aplica con kind "key". */
  passphrase?: string;
}

export interface SshTarget {
  host: string;
  port: number;
  username: string;
  auth: SshAuth;
}

export interface SshCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface SshDirectoryEntry {
  name: string;
  isDirectory: boolean;
}

export interface SshConnection {
  executeCommand(command: string, timeoutMs?: number): Promise<SshCommandResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDirectory(path: string): Promise<SshDirectoryEntry[]>;
  close(): Promise<void>;
}

export interface SshConnectOptions {
  connectTimeoutMs?: number;
}

export interface SshTransportPort {
  connect(target: SshTarget, options?: SshConnectOptions): Promise<SshConnection>;
}
