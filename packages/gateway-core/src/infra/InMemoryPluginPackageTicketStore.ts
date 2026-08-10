import { randomBytes } from "node:crypto";
import type {
  MintedPluginPackageTicket,
  PluginPackageTicketClaim,
  PluginPackageTicketPort,
} from "../domain/ports/PluginPackageTicketPort";

const TICKET_TTL_MS = 5 * 60_000;

interface StoredTicket {
  ownerId: string;
  pluginId: string;
  expiresAt: number;
}

/**
 * Sin persistencia ni Supabase, mismo criterio que `InMemoryEdgeTicketStore`
 * (ADR-056): el mint y el consume de este incremento ocurren en la misma
 * request del Gateway, así que un `Map` en memoria alcanza. Si el Gateway
 * corre en más de una instancia, esto necesitaría respaldo compartido —
 * no es el caso hoy (ver `docs/12-arquitectura-gateway.md`).
 */
export class InMemoryPluginPackageTicketStore implements PluginPackageTicketPort {
  private readonly tickets = new Map<string, StoredTicket>();

  mint(ownerId: string, pluginId: string): MintedPluginPackageTicket {
    this.sweepExpired();
    const ticket = randomBytes(24).toString("base64url");
    const expiresAt = Date.now() + TICKET_TTL_MS;
    this.tickets.set(ticket, { ownerId, pluginId, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(ticket: string): PluginPackageTicketClaim | undefined {
    const stored = this.tickets.get(ticket);
    this.tickets.delete(ticket); // un solo uso: se invalida exista o no, incluso si ya expiró
    if (!stored || stored.expiresAt < Date.now()) return undefined;
    return { ownerId: stored.ownerId, pluginId: stored.pluginId };
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [ticket, stored] of this.tickets) {
      if (stored.expiresAt < now) this.tickets.delete(ticket);
    }
  }
}
