import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentGrant, AgentGrantPort } from "@kan/core";

// Sin endpoint "buscar por email" en la Admin API de GoTrue en esta versión
// (solo `listUsers()` paginado, ver GoTrueAdminApi) — una sola página de
// 1000 cubre cualquier equipo real de este producto. Si el número de
// usuarios del sistema creciera mucho, esto necesitaría un RPC dedicado
// (`security definer`) en vez de paginar — documentado a propósito, no es
// un olvido.
const EMAIL_LOOKUP_PAGE_SIZE = 1000;

interface EdgeAgentGrantRow {
  edge_agent_id: string;
  user_id: string;
}

async function isOwner(client: SupabaseClient, edgeAgentId: string, ownerId: string): Promise<boolean> {
  const { data, error } = await client
    .from("edge_agent_pairings")
    .select("id")
    .eq("edge_agent_id", edgeAgentId)
    .eq("user_id", ownerId)
    .not("claimed_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

/**
 * Adaptador de AgentGrantPort sobre `edge_agent_grants` (capa aditiva de
 * multi-usuario) — capa siempre con el cliente `service_role` (mismo
 * criterio que `SupabasePairingStore.claim()`/`resolveOwner()`): quien
 * llama es el Gateway, ya verificó la identidad del dueño vía JWT, no una
 * sesión RLS de Supabase.
 */
export class SupabaseAgentGrantStore implements AgentGrantPort {
  constructor(private readonly client: SupabaseClient) {}

  async grant(edgeAgentId: string, ownerId: string, email: string): Promise<AgentGrant | { error: string }> {
    if (!(await isOwner(this.client, edgeAgentId, ownerId))) {
      return { error: "No sos el dueño de este equipo." };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const { data: usersPage, error: listError } = await this.client.auth.admin.listUsers({
      page: 1,
      perPage: EMAIL_LOOKUP_PAGE_SIZE,
    });
    if (listError) throw new Error(listError.message);
    const invitedUser = usersPage.users.find((user) => user.email?.toLowerCase() === normalizedEmail);
    if (!invitedUser) {
      return { error: "No encontramos ningún usuario con ese email." };
    }
    if (invitedUser.id === ownerId) {
      return { error: "Ya sos el dueño de este equipo." };
    }

    const { error: insertError } = await this.client
      .from("edge_agent_grants")
      .upsert(
        { edge_agent_id: edgeAgentId, owner_id: ownerId, user_id: invitedUser.id },
        { onConflict: "edge_agent_id,user_id" },
      );
    if (insertError) throw new Error(insertError.message);

    return { userId: invitedUser.id, email: invitedUser.email ?? normalizedEmail };
  }

  async revoke(edgeAgentId: string, ownerId: string, userId: string): Promise<void> {
    // Filtrado también por owner_id (no solo edge_agent_id/user_id): si
    // quien llama no es el dueño real, el WHERE no matchea ninguna fila —
    // mismo efecto que rechazar, sin necesitar un chequeo aparte ni que el
    // caller tenga que interpretar un resultado.
    const { error } = await this.client
      .from("edge_agent_grants")
      .delete()
      .eq("edge_agent_id", edgeAgentId)
      .eq("owner_id", ownerId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }

  async list(edgeAgentId: string, ownerId: string): Promise<AgentGrant[]> {
    if (!(await isOwner(this.client, edgeAgentId, ownerId))) return [];

    const { data, error } = await this.client
      .from("edge_agent_grants")
      .select("user_id")
      .eq("edge_agent_id", edgeAgentId);
    if (error) throw new Error(error.message);

    const userIds = ((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id);
    if (userIds.length === 0) return [];

    const { data: usersPage, error: listError } = await this.client.auth.admin.listUsers({
      page: 1,
      perPage: EMAIL_LOOKUP_PAGE_SIZE,
    });
    if (listError) throw new Error(listError.message);
    const emailById = new Map(usersPage.users.map((user) => [user.id, user.email ?? ""]));

    return userIds.map((userId) => ({ userId, email: emailById.get(userId) ?? "" }));
  }

  async listAll(): Promise<Array<{ edgeAgentId: string; userId: string }>> {
    const { data, error } = await this.client.from("edge_agent_grants").select("edge_agent_id, user_id");
    if (error) throw new Error(error.message);
    return ((data ?? []) as EdgeAgentGrantRow[]).map((row) => ({ edgeAgentId: row.edge_agent_id, userId: row.user_id }));
  }
}
