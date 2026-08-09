import { SupabaseAuthAdapter, SupabaseUserProfileAdapter } from "@kan/supabase-adapter";
import {
  RegisterUserUseCase,
  SignInWithPasswordUseCase,
  RequestMagicLinkUseCase,
  RequestOAuthSignInUseCase,
  SignOutUseCase,
  GetCurrentUserUseCase,
  GetDashboardSummaryUseCase,
  UpdateDisplayNameUseCase,
} from "@kan/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Composition root de identidad/perfil (mismo rol que buildUseCase() en
 * app/api/chat/route.ts): el único lugar donde se instancian los
 * adaptadores concretos de @kan/supabase-adapter. Todo lo demás en
 * apps/web solo conoce los Use Cases de @kan/core.
 */
export async function buildAuthUseCases() {
  const client = await createSupabaseServerClient();
  const authPort = new SupabaseAuthAdapter(client);
  const profilePort = new SupabaseUserProfileAdapter(client);

  return {
    registerUser: new RegisterUserUseCase(authPort),
    signInWithPassword: new SignInWithPasswordUseCase(authPort),
    requestMagicLink: new RequestMagicLinkUseCase(authPort),
    requestOAuthSignIn: new RequestOAuthSignInUseCase(authPort),
    signOut: new SignOutUseCase(authPort),
    getCurrentUser: new GetCurrentUserUseCase(authPort),
    getDashboardSummary: new GetDashboardSummaryUseCase(profilePort),
    updateDisplayName: new UpdateDisplayNameUseCase(profilePort),
  };
}
