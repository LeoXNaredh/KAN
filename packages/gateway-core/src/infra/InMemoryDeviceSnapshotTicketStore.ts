import { randomBytes } from "node:crypto";
import type {
  DeviceSnapshotTicketClaim,
  DeviceSnapshotTicketPort,
  MintedDeviceSnapshotTicket,
} from "../domain/ports/DeviceSnapshotTicketPort";

const TICKET_TTL_MS = 5 * 60_000;

interface StoredTicket {
  ownerId: string;
  deviceId: string;
  expiresAt: number;
}

/**
 * Sin persistencia ni Supabase, mismo criterio que
 * `InMemoryPluginPackageTicketStore`: mint y consume ocurren en la misma
 * request del Gateway, un `Map` en memoria alcanza.
 */
export class InMemoryDeviceSnapshotTicketStore implements DeviceSnapshotTicketPort {
  private readonly tickets = new Map<string, StoredTicket>();

  mint(ownerId: string, deviceId: string): MintedDeviceSnapshotTicket {
    this.sweepExpired();
    const ticket = randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + TICKET_TTL_MS;
    this.tickets.set(ticket, { ownerId, deviceId, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(ticket: string): DeviceSnapshotTicketClaim | undefined {
    const stored = this.tickets.get(ticket);
    this.tickets.delete(ticket); // un solo uso: se invalida exista o no, incluso si ya expiró
    if (!stored || stored.expiresAt < Date.now()) return undefined;
    return { ownerId: stored.ownerId, deviceId: stored.deviceId };
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [ticket, stored] of this.tickets) {
      if (stored.expiresAt < now) this.tickets.delete(ticket);
    }
  }
}
