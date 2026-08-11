import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryEdgeTicketStore } from "./InMemoryEdgeTicketStore";

describe("InMemoryEdgeTicketStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mint devuelve un ticket y una fecha de expiración futura", () => {
    const store = new InMemoryEdgeTicketStore();

    const { ticket, expiresAt } = store.mint("user-1");

    expect(ticket).toBeTruthy();
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("consume devuelve el ownerId para un ticket recién emitido", () => {
    const store = new InMemoryEdgeTicketStore();
    const { ticket } = store.mint("user-1");

    expect(store.consume(ticket)).toEqual({ ownerId: "user-1" });
  });

  it("consume es de un solo uso — el segundo consumo del mismo ticket falla", () => {
    const store = new InMemoryEdgeTicketStore();
    const { ticket } = store.mint("user-1");

    store.consume(ticket);

    expect(store.consume(ticket)).toBeUndefined();
  });

  it("consume devuelve undefined para un ticket que nunca existió", () => {
    const store = new InMemoryEdgeTicketStore();

    expect(store.consume("ticket-inventado")).toBeUndefined();
  });

  it("consume devuelve undefined para un ticket expirado", () => {
    const store = new InMemoryEdgeTicketStore();
    const { ticket } = store.mint("user-1");

    vi.advanceTimersByTime(60_001);

    expect(store.consume(ticket)).toBeUndefined();
  });

  it("dos mint() del mismo owner devuelven tickets distintos", () => {
    const store = new InMemoryEdgeTicketStore();

    const first = store.mint("user-1");
    const second = store.mint("user-1");

    expect(first.ticket).not.toBe(second.ticket);
  });
});
