import type { LiveSessionConfig, LiveSessionPort } from "@kan/core";
import type { ToolDescriptor } from "@kan/plugin-contract";

export interface GatewayLiveSessionProviderConfig {
  baseUrl: string;
  internalToken: string;
  /** P2 incremento 2 (docs/19): JWT del usuario, reenviado como `X-User-Token`. */
  userToken?: string;
  /** URL pública del WS /live-voice del Gateway — distinta del baseUrl HTTP. */
  wsUrl: string;
  model?: string;
}

const CREATE_SESSION_TIMEOUT_MS = 10_000;
// Confirmado en vivo (ADR-044): "gemini-2.5-flash-live-preview" no existe
// para esta cuenta, "gemini-3.1-flash-live-preview" sí responde setupComplete.
const DEFAULT_MODEL = "gemini-3.1-flash-live-preview";

/**
 * Implementación de LiveSessionPort (ADR-044, rediseño vía proxy del
 * Gateway): en vez de mintear un token efímero de Gemini directo (la
 * redención fallaba con esta cuenta — ver ADR-044), registra la sesión en
 * el Gateway (`POST /v1/live-sessions`) — el browser termina conectando al
 * WS `/live-voice` del propio Gateway, que abre la conexión real a Gemini
 * con la key del lado del servidor (`GeminiLiveProxy`). Mismo criterio
 * "nunca exponer secretos al cliente" que ya rige `GatewayToolProvider`.
 */
export class GatewayLiveSessionProvider implements LiveSessionPort {
  private readonly model: string;

  constructor(private readonly config: GatewayLiveSessionProviderConfig) {
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async createSession(systemPrompt: string, tools: ToolDescriptor[]): Promise<LiveSessionConfig> {
    const response = await fetch(`${this.config.baseUrl}/v1/live-sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.internalToken}`,
        // Túnel ngrok gratuito en producción: sin esto, intercepta la
        // request con su página de advertencia HTML en vez de dejarla pasar.
        "ngrok-skip-browser-warning": "true",
        ...(this.config.userToken ? { "X-User-Token": this.config.userToken } : {}),
      },
      body: JSON.stringify({ model: this.model, systemPrompt, tools }),
      signal: AbortSignal.timeout(CREATE_SESSION_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `El Gateway respondió ${response.status} al registrar la sesión de voz.`);
    }

    const { sessionId, expiresAt } = (await response.json()) as { sessionId: string; expiresAt: string };
    return { model: this.model, wsUrl: this.config.wsUrl, token: sessionId, expiresAt };
  }
}
