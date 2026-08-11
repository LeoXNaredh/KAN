import { randomBytes } from "node:crypto";
import type { EdgeTicketClaim, EdgeTicketPort, MintedEdgeTicket } from "../domain/ports/EdgeTicketPort";

const TICKET_TTL_MS = 60_000;

interface StoredTicket {
  ownerId: string;
  expiresAt: number;
}

/**
 * Sin persistencia ni Supabase a propósito: a diferencia del pairing (que
 * sobrevive un reinicio del Edge Agent), un ticket vive segundos — el mismo
 * proceso que lo emite es el que lo consume unos milisegundos después, en el
 * handshake del WS. Un `Map` en memoria del propio Gateway alcanza.
 */
export class InMemoryEdgeTicketStore implements EdgeTicketPort {
  private readonly tickets = new Map<string, StoredTicket>();

  mint(ownerId: string): MintedEdgeTicket {
    this.sweepExpired();
    const ticket = randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + TICKET_TTL_MS;
    this.tickets.set(ticket, { ownerId, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(ticket: string): EdgeTicketClaim | undefined {
    const stored = this.tickets.get(ticket);
    this.tickets.delete(ticket); // un solo uso: se invalida exista o no, incluso si ya expiró
    if (!stored || stored.expiresAt < Date.now()) return undefined;
    return { ownerId: stored.ownerId };
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [ticket, stored] of this.tickets) {
      if (stored.expiresAt < now) this.tickets.delete(ticket);
    }
  }
}
