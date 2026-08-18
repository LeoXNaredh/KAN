import type { ToolDescriptor } from "@kan/plugin-contract";

const CONFIRM_PENDING_ACTION_TOOL = "confirm_pending_action";

/**
 * Tool exclusiva de la sesión de voz Live (ADR-059) — el chat de texto
 * resuelve una confirmación pendiente con un botón real en la UI
 * (`SendMessageInput.confirmationResponse`), no con esta tool; por voz no
 * hay botones, así que el modelo la invoca él mismo después de preguntar
 * "¿confirmás?" y escuchar la respuesta hablada. A diferencia de las tools
 * de memoria/contexto de sesión (`memoryTools.ts`/`sessionContextTools.ts`),
 * esta SÍ cruza al Gateway (`ToolProviderPort.resolveConfirmation()`) — nunca
 * se resuelve puramente local.
 */
export const CONFIRM_PENDING_ACTION_TOOL_DESCRIPTOR: ToolDescriptor = {
  name: CONFIRM_PENDING_ACTION_TOOL,
  description:
    "Confirma o cancela una acción física que quedó pendiente (un resultado de tool anterior con requiresConfirmation:true). " +
    "Llamala recién después de preguntarle al usuario '¿confirmás?' en voz alta y escuchar su respuesta — nunca antes, y nunca " +
    "reintentes la acción original directo.",
  inputSchema: {
    type: "object",
    properties: {
      confirmationId: {
        type: "string",
        description: "El id de la confirmación pendiente, tal como llegó en el resultado de la tool anterior.",
      },
      approved: { type: "boolean", description: "true si el usuario confirmó de palabra, false si canceló." },
    },
    required: ["confirmationId", "approved"],
  },
};

export function isConfirmPendingActionToolName(name: string): boolean {
  return name === CONFIRM_PENDING_ACTION_TOOL;
}

export function parseConfirmPendingActionArgs(args: unknown): { confirmationId: string; approved: boolean } | undefined {
  const confirmationId = (args as { confirmationId?: unknown } | null)?.confirmationId;
  const approved = (args as { approved?: unknown } | null)?.approved;
  if (typeof confirmationId !== "string" || !confirmationId.trim() || typeof approved !== "boolean") return undefined;
  return { confirmationId, approved };
}
