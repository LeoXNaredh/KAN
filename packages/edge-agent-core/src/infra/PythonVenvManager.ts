import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import type { CreatedVenv, VenvManagerPort } from "../domain/ports/VenvManagerPort";

const CANDIDATE_INTERPRETERS = ["python3", "python", "py"];

/**
 * Misma lógica de resolución de path que `create()` usa internamente —
 * exportada para que `SidecarProxyPlugin` pueda ubicar el intérprete de
 * un plugin ya instalado (reconstruido en boot desde `InstalledPlugin`)
 * sin volver a crear el venv ni duplicar la lógica de plataforma.
 */
export function resolveVenvPythonPath(pluginDir: string): string {
  const venvDir = join(pluginDir, ".venv");
  return platform() === "win32" ? join(venvDir, "Scripts", "python.exe") : join(venvDir, "bin", "python");
}

function runCommand(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${command} ${args.join(" ")}\` salió con código ${code}: ${stderr.trim() || "sin salida"}`));
    });
  });
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await runCommand(command, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * venv puro, sin Docker como prerequisito (ADR-056, decisión de alcance).
 * Resuelve el intérprete probando `python3`/`python`/`py` en ese orden —
 * honra `KAN_PYTHON_EXECUTABLE` si está fijado, para el caso (documentado
 * como gotcha conocido en `plugins/plugin-vision-py`) de instalaciones de
 * Python de Microsoft Store en Windows que no resuelven bien por PATH.
 */
export class PythonVenvManager implements VenvManagerPort {
  async create(pluginDir: string): Promise<CreatedVenv> {
    const interpreter = await this.resolveInterpreter();
    const venvDir = join(pluginDir, ".venv");
    await runCommand(interpreter, ["-m", "venv", venvDir]);

    const pythonExecutablePath = resolveVenvPythonPath(pluginDir);
    try {
      await access(pythonExecutablePath, constants.X_OK);
    } catch {
      throw new Error(`El venv se creó en ${venvDir} pero no se encontró el intérprete en ${pythonExecutablePath}.`);
    }

    return { pythonExecutablePath };
  }

  async install(pythonExecutablePath: string, requirementsPath: string): Promise<void> {
    await runCommand(pythonExecutablePath, ["-m", "pip", "install", "-r", requirementsPath]);
  }

  private async resolveInterpreter(): Promise<string> {
    const override = process.env.KAN_PYTHON_EXECUTABLE;
    if (override) return override;

    for (const candidate of CANDIDATE_INTERPRETERS) {
      if (await commandExists(candidate)) return candidate;
    }
    throw new Error(
      "No se encontró un intérprete de Python (probé python3/python/py). Instalá Python o fijá KAN_PYTHON_EXECUTABLE.",
    );
  }
}
