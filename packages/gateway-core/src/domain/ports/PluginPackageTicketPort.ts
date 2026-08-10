export interface PluginPackageTicketClaim {
  ownerId: string;
  pluginId: string;
}

export interface MintedPluginPackageTicket {
  ticket: string;
  expiresAt: string;
}

/**
 * Ticket de un solo uso para autorizar la descarga de un paquete de
 * plugin (ADR-056, Fase 4) — mismo molde que `EdgeTicketPort`, pero TTL
 * más largo (minutos, no segundos): a diferencia del handshake WS
 * instantáneo, acá hay una descarga HTTP real de un `.tar.gz` de por
 * medio. Hoy `mint()`+`consume()` ocurren en la misma request del lado
 * del Gateway (ver `pluginRoutes.ts`) — se mantienen como dos operaciones
 * separadas a propósito, para no tener que rediseñar el puerto el día que
 * el mint y el consume pasen a ocurrir en requests distintas.
 */
export interface PluginPackageTicketPort {
  mint(ownerId: string, pluginId: string): MintedPluginPackageTicket;
  /** Un solo uso: consumirlo lo invalida, exista o no. `undefined` si no existía, ya se usó, o expiró. */
  consume(ticket: string): PluginPackageTicketClaim | undefined;
}
