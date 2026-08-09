import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { LoggerPort } from "@kan/plugin-contract";
import type { ToolDescriptor } from "@kan/plugin-contract";
import type { LiveVoiceSessionStore, LiveVoiceSessionConfig } from "../application/LiveVoiceSessionStore";

const DEFAULT_GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
// El audio va en base64 dentro de mensajes JSON — más pesado que el
// protocolo Core<->Edge Agent, pero cada chunk sigue siendo chico (~100ms).
const MAX_PAYLOAD_BYTES = 1024 * 1024;

/**
 * Mapeo mínimo ToolDescriptor -> functionDeclaration de Gemini, duplicado a
 * propósito de `toFunctionDeclaration` en `@kan/ai-abstraction` (ADR-044):
 * `gateway-core` no depende de ese paquete (vendor-specific de IA, capa de
 * Core Cloud) y esta es la única pieza que necesitaría — 3 campos, no
 * amerita cruzar esa frontera de paquetes por tan poco.
 */
function toGeminiFunctionDeclaration(tool: ToolDescriptor) {
  return {
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.inputSchema && Object.keys(tool.inputSchema).length ? tool.inputSchema : undefined,
  };
}

/**
 * Proxy WS transparente Gateway<->Gemini Live API (ADR-044, rediseño tras
 * confirmar en vivo que la redención de tokens efímeros no funciona con
 * esta cuenta): el browser conecta acá (`/live-voice?sessionId=...`), nunca
 * directo a Gemini — la API key real vive y se usa enteramente del lado
 * del servidor. Mismo criterio arquitectónico que ADR-009 (el WS
 * Core<->Edge Agent): un WebSocket en tiempo real necesita un proceso
 * persistente, no una function serverless — `apps/gateway` ya es ese
 * proceso, esto es extenderlo, no un servicio nuevo.
 *
 * Corre en modo `noServer`, igual que `WsConnectionManager` — `apps/gateway`
 * decide cuándo delegarle un 'upgrade'. El único mensaje que arma este
 * proxy es el `setup` inicial hacia Gemini (con la config ya resuelta por
 * `CreateLiveSessionUseCase` del lado de `apps/web`, entregada acá vía
 * `LiveVoiceSessionStore`); todo lo demás es relay de bytes sin
 * interpretar — el browser manda audio/tool responses y recibe
 * audio/tool calls con exactamente el mismo protocolo que si hablara
 * directo con Gemini (`useLiveSession.ts` no cambia su lectura de mensajes).
 */
export class GeminiLiveProxy {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  constructor(
    private readonly sessionStore: LiveVoiceSessionStore,
    private readonly apiKey: string,
    private readonly logger: LoggerPort,
    private readonly geminiWsUrl: string = DEFAULT_GEMINI_WS_URL,
  ) {}

  /** Se invoca desde el evento 'upgrade' del http.Server de apps/gateway. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const sessionId = new URL(request.url ?? "/", "http://internal").searchParams.get("sessionId");
    const config = sessionId ? this.sessionStore.claim(sessionId) : undefined;

    if (!config) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (browserSocket) => this.proxy(browserSocket, config));
  }

  private proxy(browserSocket: WebSocket, config: LiveVoiceSessionConfig): void {
    const geminiSocket = new WebSocket(`${this.geminiWsUrl}?key=${encodeURIComponent(this.apiKey)}`);
    // El browser puede empezar a mandar audio antes de que termine de abrir
    // la conexión saliente a Gemini — se buffer y se vacía apenas abre.
    let queuedFromBrowser: string[] = [];

    geminiSocket.on("open", () => {
      geminiSocket.send(
        JSON.stringify({
          setup: {
            model: `models/${config.model}`,
            generationConfig: { responseModalities: ["AUDIO"] },
            systemInstruction: { parts: [{ text: config.systemPrompt }] },
            tools: config.tools.length
              ? [{ functionDeclarations: config.tools.map(toGeminiFunctionDeclaration) }]
              : undefined,
          },
        }),
      );
      for (const message of queuedFromBrowser) geminiSocket.send(message);
      queuedFromBrowser = [];
    });

    browserSocket.on("message", (data) => {
      const text = data.toString();
      if (geminiSocket.readyState === WebSocket.OPEN) geminiSocket.send(text);
      else queuedFromBrowser.push(text);
    });

    geminiSocket.on("message", (data) => {
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(data.toString());
    });

    browserSocket.on("close", () => geminiSocket.close());
    browserSocket.on("error", () => geminiSocket.close());

    geminiSocket.on("close", (code, reason) => {
      this.logger.info(`[GeminiLiveProxy] sesión con Gemini cerrada: ${code} ${reason.toString()}`);
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close();
    });
    geminiSocket.on("error", (error) => {
      this.logger.warn(`[GeminiLiveProxy] error de conexión con Gemini: ${error.message}`);
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close();
    });
  }
}
