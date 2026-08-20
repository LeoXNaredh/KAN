import { describe, expect, it } from "vitest";
import { CompositeNotificationService } from "./CompositeNotificationService";
import type { NotificationServicePort } from "../domain/ports/NotificationServicePort";

function fakeService(notify: NotificationServicePort["notify"]): NotificationServicePort {
  return { notify };
}

describe("CompositeNotificationService", () => {
  it("manda la notificación a todos los servicios en paralelo", async () => {
    const calls: string[] = [];
    const a = fakeService(async () => {
      calls.push("a");
    });
    const b = fakeService(async () => {
      calls.push("b");
    });
    const composite = new CompositeNotificationService([a, b]);

    await composite.notify({ userId: "user-1", channel: "push", title: "Alerta de KAN", body: "Listo" });

    expect(calls.sort()).toEqual(["a", "b"]);
  });

  it("si un servicio falla, los demás igual se ejecutan y notify() no lanza", async () => {
    const calls: string[] = [];
    const failing = fakeService(async () => {
      throw new Error("caído");
    });
    const ok = fakeService(async () => {
      calls.push("ok");
    });
    const composite = new CompositeNotificationService([failing, ok]);

    await expect(
      composite.notify({ userId: "user-1", channel: "push", title: "Alerta de KAN", body: "Listo" }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(["ok"]);
  });

  it("con una lista vacía de servicios, no hace nada y no lanza", async () => {
    const composite = new CompositeNotificationService([]);
    await expect(
      composite.notify({ userId: "user-1", channel: "push", title: "Alerta de KAN", body: "Listo" }),
    ).resolves.toBeUndefined();
  });
});
