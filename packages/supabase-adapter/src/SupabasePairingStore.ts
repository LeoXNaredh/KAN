import { createHash, randomBytes, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PairingClaim, PairingCode, PairingPort } from "@kan/core";

// Sin 0/O/1/I/L (ambiguos al tipear a mano) — mismo criterio que códigos de
// pairing de otros productos (Tailscale, Plex).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const CODE_TTL_MS = 10 * 60 * 1000;

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * Adaptador de PairingPort sobre `edge_agent_pairings` (docs/19 P2,
 * incremento 3). Dos modos de acceso a la misma tabla, según qué cliente se
 * inyecte (mismo criterio que ADR-026): `generateCode()` se usa con la
 * sesión del usuario (anon key + RLS, apps/web); `claim()`/`resolveOwner()`
 * se usan con la service_role key (apps/gateway) porque quien reclama es el
 * Edge Agent, sin sesión de usuario — RLS no lo permitiría de otra forma.
 */
export class SupabasePairingStore implements PairingPort {
  constructor(private readonly client: SupabaseClient) {}

  async generateCode(userId: string): Promise<PairingCode> {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    const { error } = await this.client
      .from("edge_agent_pairings")
      .insert({ user_id: userId, pairing_code: code, expires_at: expiresAt });
    if (error) throw new Error(error.message);
    return { code, expiresAt };
  }

  async claim(code: string, edgeAgentId: string): Promise<PairingClaim | undefined> {
    const secret = randomBytes(32).toString("hex");
    const { data, error } = await this.client
      .from("edge_agent_pairings")
      .update({
        edge_agent_id: edgeAgentId,
        pairing_secret_hash: hashSecret(secret),
        claimed_at: new Date().toISOString(),
      })
      .eq("pairing_code", code)
      .is("claimed_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("user_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return undefined; // código inexistente, ya usado, o vencido — o alguien más lo reclamó justo antes
    return { ownerId: (data as { user_id: string }).user_id, secret };
  }

  async resolveOwner(secret: string, edgeAgentId: string): Promise<string | undefined> {
    const { data, error } = await this.client
      .from("edge_agent_pairings")
      .select("user_id")
      .eq("pairing_secret_hash", hashSecret(secret))
      .eq("edge_agent_id", edgeAgentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { user_id: string } | null)?.user_id;
  }
}
