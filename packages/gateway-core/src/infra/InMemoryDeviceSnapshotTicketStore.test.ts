import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDeviceSnapshotTicketStore } from "./InMemoryDeviceSnapshotTicketStore";

describe("InMemoryDeviceSnapshotTicketStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mint devuelve un ticket y una fecha de expiración futura", () => {
    const store = new InMemoryDeviceSnapshotTicketStore();

    const { ticket, expiresAt } = store.mint("user-1", "device-1");

    expect(ticket).toBeTruthy();
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("consume devuelve el ownerId y el deviceId para un ticket recién emitido", () => {
    const store = new InMemoryDeviceSnapshotTicketStore();
    const { ticket } = store.mint("user-1", "device-1");

    expect(store.consume(ticket)).toEqual({ ownerId: "user-1", deviceId: "device-1" });
  });

  it("consume es de un solo uso — el segundo consumo del mismo ticket falla", () => {
    const store = new InMemoryDeviceSnapshotTicketStore();
    const { ticket } = store.mint("user-1", "device-1");

    store.consume(ticket);

    expect(store.consume(ticket)).toBeUndefined();
  });

  it("consume devuelve undefined para un ticket que nunca existió", () => {
    const store = new InMemoryDeviceSnapshotTicketStore();

    expect(store.consume("ticket-inventado")).toBeUndefined();
  });

  it("consume devuelve undefined para un ticket expirado", () => {
    const store = new InMemoryDeviceSnapshotTicketStore();
    const { ticket } = store.mint("user-1", "device-1");

    vi.advanceTimersByTime(5 * 60_000 + 1);

    expect(store.consume(ticket)).toBeUndefined();
  });

  it("dos mint() del mismo owner/dispositivo devuelven tickets distintos", () => {
    const store = new InMemoryDeviceSnapshotTicketStore();

    const first = store.mint("user-1", "device-1");
    const second = store.mint("user-1", "device-1");

    expect(first.ticket).not.toBe(second.ticket);
  });
});
