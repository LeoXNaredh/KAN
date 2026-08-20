export interface AgentGrant {
  userId: string;
  email: string;
}

/**
 * Puerto de acceso multi-usuario sobre un Edge Agent (docs/19 P2,
 * extensión) — capa aditiva sobre `PairingPort`: el pairing sigue siendo
 * la única fuente de verdad de quién es el dueño real; esto solo modela "a
 * quién más le dio acceso ese dueño". Nunca reemplaza `ownerId`.
 */
export interface AgentGrantPort {
  /**
   * Invita por email — resuelve el email a un usuario real (Admin API) y
   * verifica que `ownerId` sea de verdad el dueño de `edgeAgentId` antes de
   * otorgar nada. `{ error }` (nunca lanza) si el email no corresponde a
   * ningún usuario registrado, o si `ownerId` no es el dueño real.
   */
  grant(edgeAgentId: string, ownerId: string, email: string): Promise<AgentGrant | { error: string }>;
  /** `ownerId` es quien pide revocar — el DELETE solo afecta filas de ese `edgeAgentId` cuyo `owner_id` coincida, así que un no-dueño no borra nada (nunca lanza, nunca hace falta chequear el resultado). */
  revoke(edgeAgentId: string, ownerId: string, userId: string): Promise<void>;
  /** Quién tiene acceso invitado a este Edge Agent — vacío si `ownerId` no es el dueño real. */
  list(edgeAgentId: string, ownerId: string): Promise<AgentGrant[]>;
  /** Todos los grants activos del sistema — hidratación del cache en memoria de `AgentRegistry` al arrancar el Gateway. */
  listAll(): Promise<Array<{ edgeAgentId: string; userId: string }>>;
}
