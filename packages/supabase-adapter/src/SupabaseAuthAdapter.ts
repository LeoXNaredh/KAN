import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AuthPort, PasswordCredentials, UserIdentity } from "@kan/core";

function toUserIdentity(user: User): UserIdentity {
  return { userId: user.id, email: user.email ?? "" };
}

/**
 * Adaptador de AuthPort sobre `@supabase/supabase-js` (ADR-017, docs/00).
 * Recibe el cliente ya construido por inyección — no sabe nada de cookies
 * ni de Next.js, lo que lo hace reutilizable para un futuro cliente móvil
 * (roadmap P7) sin rediseño.
 */
export class SupabaseAuthAdapter implements AuthPort {
  constructor(private readonly client: SupabaseClient) {}

  async registerWithPassword({ email, password }: PasswordCredentials): Promise<UserIdentity> {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error("Supabase no devolvió un usuario tras el registro.");
    return toUserIdentity(data.user);
  }

  async signInWithPassword({ email, password }: PasswordCredentials): Promise<UserIdentity> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return toUserIdentity(data.user);
  }

  async sendMagicLink(email: string, redirectTo?: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
    });
    if (error) throw new Error(error.message);
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw new Error(error.message);
  }

  async getCurrentUser(): Promise<UserIdentity | undefined> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) return undefined;
    return toUserIdentity(data.user);
  }
}
