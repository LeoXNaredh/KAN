/** Identidad mínima de un usuario autenticado (ADR-017, docs/00). */
export interface UserIdentity {
  userId: string;
  email: string;
}
