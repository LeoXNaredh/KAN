import { GeneratePairingCodeUseCase } from "@kan/core";
import { SupabasePairingStore } from "@kan/supabase-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Composition root de pairing de Edge Agents (docs/19 P2, incremento 3) —
 * mismo rol que lib/preferences/composition.ts. Cliente de sesión (anon key
 * + RLS), no service_role: generar un código es una acción del usuario
 * logueado, no del Gateway.
 */
export async function buildDeviceUseCases() {
  const client = await createSupabaseServerClient();
  const pairingStore = new SupabasePairingStore(client);

  return {
    generatePairingCode: new GeneratePairingCodeUseCase(pairingStore),
  };
}
