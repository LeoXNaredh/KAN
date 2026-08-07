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
  /**
   * `accessToken` (ADR-029, docs/00): si se pasa, valida ese JWT directo
   * (mismo mecanismo que usaría un cliente sin cookies — ej. la app móvil,
   * roadmap P7) en vez de mirar la sesión implícita del cliente inyectado.
   * Sin `accessToken`, se comporta como siempre. `undefined` si no hay
   * sesión activa (ni implícita ni vía el token dado).
   */
  getCurrentUser(accessToken?: string): Promise<UserIdentity | undefined>;
}
