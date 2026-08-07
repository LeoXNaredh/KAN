import type { UserIdentity } from "../entities/UserIdentity";

export interface PasswordCredentials {
  email: string;
  password: string;
}

/**
 * Puerto de identidad/autenticación (ADR-017, docs/00). El adaptador real
 * (`@kan/supabase-adapter`) recibe un cliente ya construido por inyección —
 * este puerto no sabe nada de cookies, sesiones HTTP ni Next.js.
 */
export interface AuthPort {
  registerWithPassword(credentials: PasswordCredentials): Promise<UserIdentity>;
  signInWithPassword(credentials: PasswordCredentials): Promise<UserIdentity>;
  /**
   * `redirectTo` es a dónde debe volver el usuario tras hacer click en el
   * link (ej. `${origin}/auth/callback` en apps/web) — el puerto no asume
   * ningún transporte concreto, así que quien lo llama decide la URL.
   */
  sendMagicLink(email: string, redirectTo?: string): Promise<void>;
  signOut(): Promise<void>;
  /** `undefined` si no hay sesión activa en el cliente inyectado. */
  getCurrentUser(): Promise<UserIdentity | undefined>;
}
