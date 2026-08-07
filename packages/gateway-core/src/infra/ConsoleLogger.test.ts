import { describe, expect, it, vi, afterEach } from "vitest";
import { ConsoleLogger } from "./ConsoleLogger";

describe("ConsoleLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("debug() enruta a console.log con nivel DEBUG", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    new ConsoleLogger().debug("cargando plugins");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/\[DEBUG\] cargando plugins$/);
  });

  it("info() enruta a console.info con nivel INFO", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    new ConsoleLogger().info("Edge Agent conectado: agent-1");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/\[INFO\] Edge Agent conectado: agent-1$/);
  });

  it("warn() enruta a console.warn con nivel WARN", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    new ConsoleLogger().warn("job vencido, se descarta");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/\[WARN\] job vencido, se descarta$/);
  });

  it("error() enruta a console.error con nivel ERROR", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    new ConsoleLogger().error("no se pudo escribir a disco");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/\[ERROR\] no se pudo escribir a disco$/);
  });

  it("con meta, lo pasa como segundo argumento al método de console correspondiente", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const meta = { taskId: "t1" };
    new ConsoleLogger().error("falló", meta);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(meta);
  });
});
