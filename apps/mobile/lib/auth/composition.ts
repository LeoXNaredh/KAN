import { SupabaseAuthAdapter } from "@kan/supabase-adapter";
import { RegisterUserUseCase, SignInWithPasswordUseCase, RequestMagicLinkUseCase, SignOutUseCase, GetCurrentUserUseCase } from "@kan/core";
import { supabase } from "../supabase/client";

/**
 * Composition root de auth para mobile (docs/18, incremento 2) — mismo rol
 * que `apps/web/lib/auth/composition.ts`, pero inyectando el cliente con
 * `AsyncStorage` (`lib/supabase/client.ts`) en vez del cookie-bound de
 * `@supabase/ssr`. Los 5 casos de uso y `SupabaseAuthAdapter` no cambian
 * una línea — es exactamente la reutilización que anticipó ADR-017.
 *
 * Magic Link (`RequestMagicLinkUseCase`) se expone pero no tiene pantalla
 * todavía — requiere manejo de deep link (scheme + callback), fuera de
 * alcance de este incremento.
 */
export function buildAuthUseCases() {
  const authPort = new SupabaseAuthAdapter(supabase);

  return {
    registerUser: new RegisterUserUseCase(authPort),
    signInWithPassword: new SignInWithPasswordUseCase(authPort),
    requestMagicLink: new RequestMagicLinkUseCase(authPort),
    signOut: new SignOutUseCase(authPort),
    getCurrentUser: new GetCurrentUserUseCase(authPort),
  };
}

export type AuthUseCases = ReturnType<typeof buildAuthUseCases>;
