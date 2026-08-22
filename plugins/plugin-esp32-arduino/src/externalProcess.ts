import { spawn } from "node:child_process";

export interface ExternalProcessResult {
  /** `null` si el proceso nunca llegó a arrancar (comando no encontrado) o si se lo mató por timeout. */
  exitCode: number | null;
  stderr: string;
}

/**
 * Ejecuta un binario externo hasta que termina (o timeout) — a diferencia de
 * `ProcessLauncherPort` (`@kan/edge-agent-core`, pensado para el sidecar de
 * un plugin que se queda corriendo), acá el caso es "correr `arduino-cli`/
 * `esptool`/`avrdude` una vez y esperar el resultado", más parecido a como
 * `PythonVenvManager` corre `pip install`. No se reusa `ProcessLauncherPort`
 * a propósito: traerlo como dependencia de este plugin encadenaría
 * `@kan/edge-agent-core` entero (bonjour-service, tar, ws...) en un plugin
 * que hoy no depende de nada de eso, y ningún otro plugin lo hace tampoco
 * (cada uno resuelve su propio transporte/protocolo — ver
 * `RawSerialTransportPort` de `@kan/plugin-micropython` con el mismo
 * criterio).
 */
export interface ExternalProcessPort {
  run(command: string, args: string[], options: { cwd?: string; timeoutMs: number }): Promise<ExternalProcessResult>;
}

export class NodeExternalProcess implements ExternalProcessPort {
  run(command: string, args: string[], options: { cwd?: string; timeoutMs: number }): Promise<ExternalProcessResult> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd: options.cwd, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({ exitCode: null, stderr: `${stderr}\n(se mató el proceso: no terminó en ${options.timeoutMs}ms)`.trim() });
      }, options.timeoutMs);

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      // `spawn` nunca dispara "exit" si el comando no existe (ENOENT) — sin
      // este handler, un `arduino-cli`/`esptool`/`avrdude` no instalado
      // colgaría silenciosamente hasta el timeout en vez de fallar rápido
      // con un mensaje claro ("no instalado, ver requisitos opcionales").
      child.on("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const hint = error.code === "ENOENT" ? ` — ¿está instalado y en el PATH? (requisito opcional, ver README)` : "";
        resolve({ exitCode: null, stderr: `${error.message}${hint}` });
      });

      child.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code, stderr });
      });
    });
  }
}

/** Lanza si el proceso no salió con código 0 — el error trae stderr, listo para mostrarlo tal cual en un CapabilityResult. */
export async function runOrThrow(
  externalProcess: ExternalProcessPort,
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<void> {
  const result = await externalProcess.run(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` falló: ${result.stderr.trim() || `código de salida ${result.exitCode}`}`);
  }
}
