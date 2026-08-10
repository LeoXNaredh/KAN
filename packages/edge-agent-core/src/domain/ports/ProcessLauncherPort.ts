export interface ManagedProcess {
  readonly pid: number | undefined;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
  onExit(handler: (code: number | null, signal: string | null) => void): void;
  /** Acumulado de stderr — `SidecarProxyPlugin` lo usa para dar un error accionable si el proceso muere antes del handshake. */
  onStderr(handler: (chunk: string) => void): void;
}

export interface SpawnOptions {
  cwd?: string;
  env: Record<string, string>;
}

/** Seam sobre `child_process.spawn` (ADR-056) — permite probar `SidecarProxyPlugin` sin lanzar procesos reales. */
export interface ProcessLauncherPort {
  spawn(command: string, args: string[], options: SpawnOptions): ManagedProcess;
}
