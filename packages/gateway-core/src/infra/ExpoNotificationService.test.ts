import { describe, expect, it, vi, afterEach } from "vitest";
import { ExpoNotificationService } from "./ExpoNotificationService";
import type { PushTokenStorePort } from "@kan/core";
import type { LoggerPort } from "@kan/plugin-contract";

function fakeLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakeStore(tokens: string[]): PushTokenStorePort {
  return {
    list: vi.fn(async () => tokens),
    register: vi.fn(),
    remove: vi.fn(),
  };
}

describe("ExpoNotificationService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sin tokens registrados, loguea y no llama a fetch", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const logger = fakeLogger();
    const service = new ExpoNotificationService(fakeStore([]), logger);

    await service.notify({ userId: "user-1", channel: "chat", title: "Riego", body: "Listo" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("sin tokens"));
  });

  it("con tokens, manda un solo POST a Expo con un mensaje por token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = new ExpoNotificationService(fakeStore(["tok-1", "tok-2"]), fakeLogger());

    await service.notify({ userId: "user-1", channel: "push", title: "Riego", body: "Listo" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(JSON.parse(init.body)).toEqual([
      { to: "tok-1", title: "Riego", body: "Listo" },
      { to: "tok-2", title: "Riego", body: "Listo" },
    ]);
  });

  it("si Expo responde error, loguea y no lanza", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    global.fetch = fetchMock as unknown as typeof fetch;
    const logger = fakeLogger();
    const service = new ExpoNotificationService(fakeStore(["tok-1"]), logger);

    await expect(
      service.notify({ userId: "user-1", channel: "push", title: "Riego", body: "Listo" }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("si el store o fetch lanzan, notify() nunca propaga (best-effort)", async () => {
    const store: PushTokenStorePort = {
      list: vi.fn(async () => {
        throw new Error("db caída");
      }),
      register: vi.fn(),
      remove: vi.fn(),
    };
    const logger = fakeLogger();
    const service = new ExpoNotificationService(store, logger);

    await expect(
      service.notify({ userId: "user-1", channel: "push", title: "Riego", body: "Listo" }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
