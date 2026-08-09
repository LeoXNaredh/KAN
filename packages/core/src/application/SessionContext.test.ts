import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SessionContext } from "./SessionContext";

describe("SessionContext", () => {
  it("getActiveDevice()/getActiveProject()/getCurrentTask() devuelven undefined antes de fijar nada", async () => {
    const context = new SessionContext(`u-${randomUUID()}`);

    expect(await context.getActiveDevice()).toBeUndefined();
    expect(await context.getActiveProject()).toBeUndefined();
    expect(await context.getCurrentTask()).toBeUndefined();
  });

  it("setActiveDevice() se refleja en getActiveDevice()", async () => {
    const context = new SessionContext(`u-${randomUUID()}`);

    await context.setActiveDevice("ESP32-01");

    expect(await context.getActiveDevice()).toBe("ESP32-01");
  });

  it("setActiveProject() y setCurrentTask() no pisan lo que ya había en otros campos", async () => {
    const context = new SessionContext(`u-${randomUUID()}`);

    await context.setActiveDevice("ESP32-01");
    await context.setActiveProject("Robot autónomo");
    await context.setCurrentTask("calibrar sensor");

    expect(await context.getActiveDevice()).toBe("ESP32-01");
    expect(await context.getActiveProject()).toBe("Robot autónomo");
    expect(await context.getCurrentTask()).toBe("calibrar sensor");
  });

  it("escopeado por userId — dos instancias con userId distinto no comparten estado", async () => {
    const userId1 = `u-${randomUUID()}`;
    const userId2 = `u-${randomUUID()}`;
    const contextUser1 = new SessionContext(userId1);
    const contextUser2 = new SessionContext(userId2);

    await contextUser1.setActiveDevice("ESP32-01");

    expect(await contextUser1.getActiveDevice()).toBe("ESP32-01");
    expect(await contextUser2.getActiveDevice()).toBeUndefined();
  });

  it("dos instancias con el mismo userId comparten estado (mismo backing store por proceso)", async () => {
    const userId = `u-${randomUUID()}`;
    const first = new SessionContext(userId);
    const second = new SessionContext(userId);

    await first.setActiveProject("Robot autónomo");

    expect(await second.getActiveProject()).toBe("Robot autónomo");
  });

  it("clear() borra los tres campos", async () => {
    const context = new SessionContext(`u-${randomUUID()}`);
    await context.setActiveDevice("ESP32-01");
    await context.setActiveProject("Robot autónomo");
    await context.setCurrentTask("calibrar sensor");

    await context.clear();

    expect(await context.getActiveDevice()).toBeUndefined();
    expect(await context.getActiveProject()).toBeUndefined();
    expect(await context.getCurrentTask()).toBeUndefined();
  });
});
