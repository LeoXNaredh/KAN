export interface EdgeTicketClaim {
  ownerId: string;
}

export interface MintedEdgeTicket {
  ticket: string;
  expiresAt: string;
}

/**
 * Prueba de identidad de un solo uso para el camino de navegador del
 * WebSocket `/edge` (docs/19 continuación — Simulador corriendo en
 * `apps/web`): el `WebSocket` nativo del navegador no puede mandar el header
 * `Authorization` que usa hoy el camino nativo (desktop/hardware), así que
 * un usuario ya autenticado en `apps/web` cambia su sesión por un ticket
 * efímero acá, y lo manda como query string en el handshake del WS. El
 * ticket reemplaza tanto al token compartido (`KAN_EDGE_TOKEN`, que el
 * navegador nunca debe ver) como al pairing manual (el `ownerId` ya viene
 * resuelto — no hace falta `PairingPort` para este camino).
 */
export interface EdgeTicketPort {
  mint(ownerId: string): MintedEdgeTicket;
  /** Un solo uso: consumirlo lo invalida, exista o no. `undefined` si no existía, ya se usó, o expiró. */
  consume(ticket: string): EdgeTicketClaim | undefined;
}
