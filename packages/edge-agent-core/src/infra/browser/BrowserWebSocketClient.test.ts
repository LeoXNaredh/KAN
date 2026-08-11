import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeAgentBus } from "../../application/EdgeAgentBus";
import type { LoggerPort } from "../../domain/ports/LoggerPort";
import { BrowserWebSocketClient } from "./BrowserWebSocketClient";

class FakeWebSocket {
  static OPEN = 1;
  static readonly instances: FakeWebSocket[] = [];

  readyState = 0;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  send(): void {}

  close(): void {
    this.emit("close", {});
  }

  emit(type: string, event: unknown): void {
    if (type === "open") this.readyState = FakeWebSocket.OPEN;
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
}

function fakeLogger(): LoggerPort {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("BrowserWebSocketClient", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.useFakeTimers();
    // @ts-expect-error -- stub deliberado para el test, no el WebSocket real del navegador
    globalThis.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it("pide un ticket fresco y abre un WebSocket con la URL devuelta", async () => {
    const fetchTicketUrl = vi.fn().mockResolvedValue("ws://gateway/edge?ticket=abc");
    const client = new BrowserWebSocketClient(fetchTicketUrl, new EdgeAgentBus(), fakeLogger());

    client.start();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    expect(fetchTicketUrl).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances[0]?.url).toBe("ws://gateway/edge?ticket=abc");
  });

  it("status pasa a 'connected' cuando el WebSocket emite 'open'", async () => {
    const fetchTicketUrl = vi.fn().mockResolvedValue("ws://gateway/edge?ticket=abc");
    const client = new BrowserWebSocketClient(fetchTicketUrl, new EdgeAgentBus(), fakeLogger());

    client.start();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0]!.emit("open", {});

    expect(client.status).toBe("connected");
  });

  it("un fallo al pedir el ticket no lanza — agenda reconexión con backoff", async () => {
    const fetchTicketUrl = vi.fn().mockRejectedValue(new Error("network error"));
    const logger = fakeLogger();
    const client = new BrowserWebSocketClient(fetchTicketUrl, new EdgeAgentBus(), logger);

    client.start();
    await vi.waitFor(() => expect(fetchTicketUrl).toHaveBeenCalledTimes(1));
    expect(logger.warn).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchTicketUrl.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("al reconectar tras un close, pide un ticket nuevo (no reusa el anterior)", async () => {
    const fetchTicketUrl = vi
      .fn()
      .mockResolvedValueOnce("ws://gateway/edge?ticket=first")
      .mockResolvedValueOnce("ws://gateway/edge?ticket=second");
    const client = new BrowserWebSocketClient(fetchTicketUrl, new EdgeAgentBus(), fakeLogger());

    client.start();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0]!.emit("open", {});
    FakeWebSocket.instances[0]!.emit("close", {});

    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));

    expect(FakeWebSocket.instances[1]?.url).toBe("ws://gateway/edge?ticket=second");
  });

  it("stop() detiene el cliente y no agenda más reconexiones", async () => {
    const fetchTicketUrl = vi.fn().mockResolvedValue("ws://gateway/edge?ticket=abc");
    const client = new BrowserWebSocketClient(fetchTicketUrl, new EdgeAgentBus(), fakeLogger());

    client.start();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0]!.emit("open", {});

    client.stop();
    expect(client.status).toBe("disconnected");

    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
