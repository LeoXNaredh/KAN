import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WebPushSubscription, WebPushSubscriptionStorePort } from "@kan/core";
import type { LoggerPort } from "@kan/plugin-contract";

const sendNotificationMock = vi.fn();
vi.mock("web-push", () => ({
  default: { sendNotification: (...args: unknown[]) => sendNotificationMock(...args) },
}));

// Import dinámico después del mock — vi.mock se hoistea, así que esto es
// seguro, pero se hace explícito acá para que quede claro el orden.
const { WebPushNotificationService } = await import("./WebPushNotificationService");

const VAPID = { publicKey: "pub", privateKey: "priv", subject: "mailto:test@kan.dev" };

function fakeLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function subscription(overrides: Partial<WebPushSubscription> = {}): WebPushSubscription {
  return { endpoint: "https://push.example/sub-1", keys: { p256dh: "p256dh", auth: "auth" }, ...overrides };
}

function fakeStore(subscriptions: WebPushSubscription[]): WebPushSubscriptionStorePort {
  return {
    list: vi.fn(async () => subscriptions),
    register: vi.fn(),
    remove: vi.fn(),
  };
}

describe("WebPushNotificationService", () => {
  beforeEach(() => {
    sendNotificationMock.mockReset();
  });

  it("sin suscripciones, no llama a sendNotification", async () => {
    const service = new WebPushNotificationService(fakeStore([]), VAPID, fakeLogger());

    await service.notify({ userId: "user-1", channel: "push", title: "Alerta de KAN", body: "La temperatura superó 40 grados" });

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("con una suscripción, manda el payload 'KAN' + el texto de la alerta", async () => {
    sendNotificationMock.mockResolvedValue({ statusCode: 201 });
    const sub = subscription();
    const service = new WebPushNotificationService(fakeStore([sub]), VAPID, fakeLogger());

    await service.notify({ userId: "user-1", channel: "push", title: "Alerta de KAN", body: "La temperatura superó 40 grados" });

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const [sentSub, payload, options] = sendNotificationMock.mock.calls[0];
    expect(sentSub).toEqual(sub);
    expect(JSON.parse(payload)).toEqual({ title: "KAN", body: "La temperatura superó 40 grados" });
    expect(options.vapidDetails).toEqual({ subject: VAPID.subject, publicKey: VAPID.publicKey, privateKey: VAPID.privateKey });
  });

  it("con varias suscripciones, manda un push a cada una", async () => {
    sendNotificationMock.mockResolvedValue({ statusCode: 201 });
    const subs = [subscription({ endpoint: "a" }), subscription({ endpoint: "b" })];
    const service = new WebPushNotificationService(fakeStore(subs), VAPID, fakeLogger());

    await service.notify({ userId: "user-1", channel: "push", title: "Alerta de KAN", body: "Listo" });

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
  });

  it("statusCode 410 (suscripción vencida): la borra del store y no la trata como error", async () => {
    sendNotificationMock.mockRejectedValue(Object.assign(new Error("Gone"), { statusCode: 410 }));
    const sub = subscription();
    const store = fakeStore([sub]);
    const logger = fakeLogger();
    const service = new WebPushNotificationService(store, VAPID, logger);

    await service.notify({ userId: "user-1", channel: "push", title: "Alerta de KAN", body: "Listo" });

    expect(store.remove).toHaveBeenCalledWith("user-1", sub.endpoint);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("otros errores del push service: solo loguea, no borra la suscripción, no lanza", async () => {
    sendNotificationMock.mockRejectedValue(Object.assign(new Error("Server error"), { statusCode: 500 }));
    const sub = subscription();
    const store = fakeStore([sub]);
    const logger = fakeLogger();
    const service = new WebPushNotificationService(store, VAPID, logger);

    await expect(
      service.notify({ userId: "user-1", channel: "push", title: "Alerta de KAN", body: "Listo" }),
    ).resolves.toBeUndefined();
    expect(store.remove).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("si el store lanza al listar, notify() nunca propaga (best-effort)", async () => {
    const store: WebPushSubscriptionStorePort = {
      list: vi.fn(async () => {
        throw new Error("db caída");
      }),
      register: vi.fn(),
      remove: vi.fn(),
    };
    const logger = fakeLogger();
    const service = new WebPushNotificationService(store, VAPID, logger);

    await expect(
      service.notify({ userId: "user-1", channel: "push", title: "Alerta de KAN", body: "Listo" }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
