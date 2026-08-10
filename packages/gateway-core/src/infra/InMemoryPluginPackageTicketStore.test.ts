import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryPluginPackageTicketStore } from "./InMemoryPluginPackageTicketStore";

describe("InMemoryPluginPackageTicketStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mint devuelve un ticket y una fecha de expiración futura", () => {
    const store = new InMemoryPluginPackageTicketStore();

    const { ticket, expiresAt } = store.mint("user-1", "kan-plugin-vision-py");

    expect(ticket).toBeTruthy();
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("consume devuelve el ownerId y el pluginId para un ticket recién emitido", () => {
    const store = new InMemoryPluginPackageTicketStore();
    const { ticket } = store.mint("user-1", "kan-plugin-vision-py");

    expect(store.consume(ticket)).toEqual({ ownerId: "user-1", pluginId: "kan-plugin-vision-py" });
  });

  it("consume es de un solo uso — el segundo consumo del mismo ticket falla", () => {
    const store = new InMemoryPluginPackageTicketStore();
    const { ticket } = store.mint("user-1", "kan-plugin-vision-py");

    store.consume(ticket);

    expect(store.consume(ticket)).toBeUndefined();
  });

  it("consume devuelve undefined para un ticket que nunca existió", () => {
    const store = new InMemoryPluginPackageTicketStore();

    expect(store.consume("ticket-inventado")).toBeUndefined();
  });

  it("consume devuelve undefined para un ticket expirado (TTL más largo que EdgeTicketPort — hay una descarga HTTP de por medio)", () => {
    const store = new InMemoryPluginPackageTicketStore();
    const { ticket } = store.mint("user-1", "kan-plugin-vision-py");

    vi.advanceTimersByTime(5 * 60_000 + 1);

    expect(store.consume(ticket)).toBeUndefined();
  });

  it("dos mint() del mismo owner/plugin devuelven tickets distintos", () => {
    const store = new InMemoryPluginPackageTicketStore();

    const first = store.mint("user-1", "kan-plugin-vision-py");
    const second = store.mint("user-1", "kan-plugin-vision-py");

    expect(first.ticket).not.toBe(second.ticket);
  });
});
