import { describe, expect, it, vi, beforeEach } from "vitest";
import type { LoggerPort } from "@kan/plugin-contract";

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...args: unknown[]) => sendMock(...args) };
  },
}));

// Import dinámico después del mock — mismo criterio que WebPushNotificationService.test.ts.
const { ResendEmailService } = await import("./ResendEmailService");

function fakeLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const MESSAGE = { to: "dueno@example.com", subject: "KAN — Resumen del día 01/01/2026", html: "<p>hola</p>", text: "hola" };

describe("ResendEmailService", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("manda el email con from/to/subject/html/text correctos", async () => {
    sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
    const service = new ResendEmailService("re_key", "KAN <onboarding@resend.dev>", fakeLogger());

    await service.send(MESSAGE);

    expect(sendMock).toHaveBeenCalledWith({
      from: "KAN <onboarding@resend.dev>",
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      html: MESSAGE.html,
      text: MESSAGE.text,
    });
  });

  it("si Resend devuelve error en el body, loguea pero no lanza", async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: "dominio no verificado" } });
    const logger = fakeLogger();
    const service = new ResendEmailService("re_key", "KAN <onboarding@resend.dev>", logger);

    await expect(service.send(MESSAGE)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("si el SDK lanza (red caída, etc.), nunca propaga (best-effort)", async () => {
    sendMock.mockRejectedValue(new Error("network error"));
    const logger = fakeLogger();
    const service = new ResendEmailService("re_key", "KAN <onboarding@resend.dev>", logger);

    await expect(service.send(MESSAGE)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
