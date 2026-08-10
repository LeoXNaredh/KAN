import { spawn } from "node:child_process";
import type { ManagedProcess, ProcessLauncherPort, SpawnOptions } from "../domain/ports/ProcessLauncherPort";

class NodeManagedProcess implements ManagedProcess {
  private readonly exitHandlers: Array<(code: number | null, signal: string | null) => void> = [];
  private readonly stderrHandlers: Array<(chunk: string) => void> = [];

  constructor(private readonly child: ReturnType<typeof spawn>) {
    this.child.on("exit", (code, signal) => {
      for (const handler of this.exitHandlers) handler(code, signal);
    });
    this.child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf-8");
      for (const handler of this.stderrHandlers) handler(chunk);
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  kill(signal: "SIGTERM" | "SIGKILL"): void {
    this.child.kill(signal);
  }

  onExit(handler: (code: number | null, signal: string | null) => void): void {
    this.exitHandlers.push(handler);
  }

  onStderr(handler: (chunk: string) => void): void {
    this.stderrHandlers.push(handler);
  }
}

/** Único módulo que toca `child_process.spawn` real (ADR-056). */
export class NodeProcessLauncher implements ProcessLauncherPort {
  spawn(command: string, args: string[], options: SpawnOptions): ManagedProcess {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "ignore", "pipe"] });
    return new NodeManagedProcess(child);
  }
}
