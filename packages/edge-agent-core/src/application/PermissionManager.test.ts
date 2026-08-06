import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EdgeAgentBus } from "./EdgeAgentBus";
import { PermissionManager } from "./PermissionManager";
import type { LoggerPort } from "../domain/ports/LoggerPort";

function createLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("PermissionManager", () => {
  let bus: EdgeAgentBus;
  let logger: LoggerPort;
  let manager: PermissionManager;

  beforeEach(() => {
    bus = new EdgeAgentBus();
    logger = createLogger();
    manager = new PermissionManager(bus, logger);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aprueba directo las acciones read-only", () => {
    const decision = manager.evaluate("dev-1", "read_sensor", "read-only", {});
    expect(decision).toEqual({ outcome: "approved" });
  });

  it("aprueba directo las acciones reversible", () => {
    const decision = manager.evaluate("dev-1", "toggle_led", "reversible", { on: true });
    expect(decision).toEqual({ outcome: "approved" });
  });

  it("deja pendiente una acción irreversible-material y emite permission.pending", () => {
    const handler = vi.fn();
    bus.on("permission.pending", handler);

    const decision = manager.evaluate("dev-1", "move_axis", "irreversible-material", { distanceMm: 10 });

    expect(decision.outcome).toBe("pending");
    expect(handler).toHaveBeenCalledTimes(1);
    if (decision.outcome === "pending") {
      expect(manager.listPending()).toContainEqual(decision.confirmation);
    }
  });

  it("deja pendiente una acción safety-critical", () => {
    const decision = manager.evaluate("dev-1", "fire_laser", "safety-critical", {});
    expect(decision.outcome).toBe("pending");
  });

  it("resolve(approved=true) la quita de pending y emite permission.resolved", () => {
    const decision = manager.evaluate("dev-1", "move_axis", "irreversible-material", {});
    if (decision.outcome !== "pending") throw new Error("se esperaba pending");

    const handler = vi.fn();
    bus.on("permission.resolved", handler);

    const resolved = manager.resolve(decision.confirmation.id, true);

    expect(resolved).toEqual(decision.confirmation);
    expect(manager.listPending()).toHaveLength(0);
    expect(handler).toHaveBeenCalledWith({ confirmationId: decision.confirmation.id, approved: true });
  });

  it("resolve(approved=false) también la quita de pending", () => {
    const decision = manager.evaluate("dev-1", "move_axis", "irreversible-material", {});
    if (decision.outcome !== "pending") throw new Error("se esperaba pending");

    manager.resolve(decision.confirmation.id, false);
    expect(manager.listPending()).toHaveLength(0);
  });

  it("resolve de un id desconocido devuelve undefined sin lanzar", () => {
    expect(manager.resolve("id-inexistente", true)).toBeUndefined();
  });

  it("una segunda resolución del mismo id no hace nada (no doble-resuelve)", () => {
    const decision = manager.evaluate("dev-1", "move_axis", "irreversible-material", {});
    if (decision.outcome !== "pending") throw new Error("se esperaba pending");

    manager.resolve(decision.confirmation.id, true);
    const second = manager.resolve(decision.confirmation.id, true);
    expect(second).toBeUndefined();
  });

  it("una confirmación ignorada expira sola tratada como rechazo (hallazgo M6 de docs/13)", () => {
    vi.useFakeTimers();
    const resolvedHandler = vi.fn();
    bus.on("permission.resolved", resolvedHandler);

    const decision = manager.evaluate("dev-1", "move_axis", "irreversible-material", {});
    if (decision.outcome !== "pending") throw new Error("se esperaba pending");

    expect(manager.listPending()).toHaveLength(1);

    vi.advanceTimersByTime(10 * 60_000 + 1);

    expect(manager.listPending()).toHaveLength(0);
    expect(resolvedHandler).toHaveBeenCalledWith({ confirmationId: decision.confirmation.id, approved: false });
  });

  it("resolver antes de que expire cancela el timer de expiración (no doble-emite)", () => {
    vi.useFakeTimers();
    const resolvedHandler = vi.fn();
    bus.on("permission.resolved", resolvedHandler);

    const decision = manager.evaluate("dev-1", "move_axis", "irreversible-material", {});
    if (decision.outcome !== "pending") throw new Error("se esperaba pending");

    manager.resolve(decision.confirmation.id, true);
    vi.advanceTimersByTime(10 * 60_000 + 1);

    expect(resolvedHandler).toHaveBeenCalledTimes(1);
  });
});
