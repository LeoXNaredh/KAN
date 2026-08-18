import {
  CreateLiveSessionUseCase,
  UserScopedMemoryContext,
  UserScopedPersonalityContext,
  isMemoryToolName,
  executeMemoryTool,
  isConfirmPendingActionToolName,
  parseConfirmPendingActionArgs,
} from "@kan/core";
import type { ToolExecutionResult } from "@kan/plugin-contract";
import { GatewayToolProvider } from "@/lib/gateway/GatewayToolProvider";
import { GatewayLiveSessionProvider } from "@/lib/gateway/GatewayLiveSessionProvider";
import { SupabaseMemoryStore, SupabaseUserPreferencesStore } from "@kan/supabase-adapter";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserCached } from "@/lib/auth/getCurrentUserCached";

/** Compartido entre buildCreateLiveSessionUseCase() y buildLiveToolDispatcher() — mismo patrón que lib/chat/composition.ts. */
async function buildUserScopedDeps(gatewayUserToken: string | undefined) {
  const toolProvider = new GatewayToolProvider({
    baseUrl: process.env.KAN_GATEWAY_URL ?? "http://localhost:8787",
    internalToken: process.env.KAN_GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token",
    userToken: gatewayUserToken,
  });

  const user = await getCurrentUserCached();
  if (!user) {
    return { toolProvider, memoryContext: undefined, personalityContext: undefined };
  }

  const client = await createSupabaseServerClient();
  return {
    toolProvider,
    memoryContext: new UserScopedMemoryContext(new SupabaseMemoryStore(client), user.userId),
    personalityContext: new UserScopedPersonalityContext(new SupabaseUserPreferencesStore(client), user.userId),
  };
}

/**
 * Composition root de la sesión de voz en tiempo real (ADR-044, rediseño
 * vía proxy del Gateway) — mismo patrón que buildSendMessageUseCase. A
 * diferencia de TTS/chat (que sí llaman a Gemini directo desde este
 * proceso), acá no hace falta GEMINI_API_KEY en apps/web — la key real
 * vive únicamente en apps/gateway (GeminiLiveProxy); si el Gateway no la
 * tiene configurada, POST /v1/live-sessions responde 501 y eso llega como
 * el error de GatewayLiveSessionProvider.createSession().
 */
export async function buildCreateLiveSessionUseCase(
  gatewayUserToken: string | undefined,
): Promise<CreateLiveSessionUseCase> {
  const liveSessionProvider = new GatewayLiveSessionProvider({
    baseUrl: process.env.KAN_GATEWAY_URL ?? "http://localhost:8787",
    internalToken: process.env.KAN_GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token",
    userToken: gatewayUserToken,
    wsUrl: process.env.NEXT_PUBLIC_KAN_GATEWAY_LIVE_VOICE_WS_URL ?? "ws://localhost:8787/live-voice",
    model: process.env.GEMINI_LIVE_MODEL || undefined,
  });

  const { toolProvider, memoryContext, personalityContext } = await buildUserScopedDeps(gatewayUserToken);
  return new CreateLiveSessionUseCase(liveSessionProvider, toolProvider, memoryContext, personalityContext);
}

/**
 * El relay que /api/voice/live-tool llama por cada `toolCall` que el
 * browser recibe directo de Gemini (ADR-044) — mismo dispatch de dos
 * caminos que ya usa SendMessageUseCase (memoria interna vs. Gateway), acá
 * expuesto como función porque el loop de la conversación ya no corre en
 * este servidor, corre en el browser.
 */
export async function buildLiveToolDispatcher(
  gatewayUserToken: string | undefined,
): Promise<(name: string, args: unknown) => Promise<ToolExecutionResult>> {
  const { toolProvider, memoryContext } = await buildUserScopedDeps(gatewayUserToken);

  return async function executeLiveTool(name: string, args: unknown): Promise<ToolExecutionResult> {
    if (isMemoryToolName(name) && memoryContext) {
      return executeMemoryTool(memoryContext, name, args);
    }
    // ADR-059: confirm_pending_action no es una tool call común — resuelve
    // una confirmación ya identificada, no propone una acción nueva, así
    // que va por resolveConfirmation() en vez de executeTool().
    if (isConfirmPendingActionToolName(name)) {
      const parsed = parseConfirmPendingActionArgs(args);
      if (!parsed) {
        return { success: false, error: "confirm_pending_action requiere 'confirmationId' (string) y 'approved' (boolean)." };
      }
      return toolProvider.resolveConfirmation(parsed.confirmationId, parsed.approved);
    }
    return toolProvider.executeTool(name, args);
  };
}
