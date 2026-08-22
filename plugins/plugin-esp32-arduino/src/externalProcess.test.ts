import { describe, expect, it } from "vitest";
import { NodeExternalProcess, runOrThrow } from "./externalProcess";

const TIMEOUT_MS = 5000;

describe("NodeExternalProcess", () => {
  it("devuelve exitCode 0 para un proceso exitoso", async () => {
    const process_ = new NodeExternalProcess();
    const result = await process_.run("node", ["-e", "process.exit(0)"], { timeoutMs: TIMEOUT_MS });
    expect(result).toEqual({ exitCode: 0, stderr: "" });
  });

  it("captura stderr y el exitCode no-cero de un proceso que falla", async () => {
    const process_ = new NodeExternalProcess();
    const result = await process_.run("node", ["-e", "console.error('algo salió mal'); process.exit(1)"], { timeoutMs: TIMEOUT_MS });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("algo salió mal");
  });

  it("devuelve exitCode null con un mensaje claro si el comando no existe (ENOENT)", async () => {
    const process_ = new NodeExternalProcess();
    const result = await process_.run("kan-comando-que-no-existe-jamas", [], { timeoutMs: TIMEOUT_MS });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toMatch(/instalado/);
  }, 10000);

  it("mata el proceso y devuelve exitCode null si no termina dentro del timeout", async () => {
    const process_ = new NodeExternalProcess();
    const result = await process_.run("node", ["-e", "setTimeout(() => {}, 60000)"], { timeoutMs: 200 });
    expect(result.exitCode).toBeNull();
    expect(result.stderr).toMatch(/no terminó/);
  }, 10000);
});

describe("runOrThrow", () => {
  it("no lanza si el proceso sale con código 0", async () => {
    const process_ = new NodeExternalProcess();
    await expect(runOrThrow(process_, "node", ["-e", "process.exit(0)"], { timeoutMs: TIMEOUT_MS })).resolves.toBeUndefined();
  });

  it("lanza con el stderr del proceso si sale con código distinto de 0", async () => {
    const process_ = new NodeExternalProcess();
    await expect(
      runOrThrow(process_, "node", ["-e", "console.error('falló el compile'); process.exit(1)"], { timeoutMs: TIMEOUT_MS }),
    ).rejects.toThrow(/falló el compile/);
  });
});
