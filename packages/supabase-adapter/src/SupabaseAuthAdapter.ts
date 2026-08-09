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

  async getOAuthRedirectUrl(provider: "google", redirectTo: string): Promise<string> {
    // skipBrowserRedirect: este cliente puede correr en el servidor (Server
    // Action de apps/web), donde no hay `window` al que Supabase pueda
    // redirigir solo — devolvemos la URL y quien llama hace el redirect().
    const { data, error } = await this.client.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) throw new Error(error.message);
    if (!data.url) throw new Error("Supabase no devolvió una URL de redirección OAuth.");
    return data.url;
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw new Error(error.message);
  }

  async getCurrentUser(accessToken?: string): Promise<UserIdentity | undefined> {
    const { data, error } = await this.client.auth.getUser(accessToken);
    if (error || !data.user) return undefined;
    return toUserIdentity(data.user);
  }
}
