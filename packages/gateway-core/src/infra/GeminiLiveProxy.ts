import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { LoggerPort } from "@kan/plugin-contract";
import type { ToolDescriptor } from "@kan/plugin-contract";
import type { LiveVoiceSessionStore, LiveVoiceSessionConfig } from "../application/LiveVoiceSessionStore";

const DEFAULT_GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
// Mismo default que GeminiTtsProvider (ADR-042) — un único nombre de voz
// compartido entre Live y el TTS de red, no dos configuraciones divergentes
// (ADR-060). Gemini no expone acento/locale por voz (solo timbre) — esto
// NO es "voz argentina", es consistencia de timbre entre los dos caminos de
// audio de KAN. El registro rioplatense (voseo) vive en el texto que se le
// pide sintetizar, no en la selección de voz.
const DEFAULT_VOICE = "Charon";
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
 * Un aviso de alerta pendiente de mandar — `enqueueOrSend()` decide al toque
 * si sale ya o si tiene que esperar (ver `LiveVoiceConnection`).
 */
interface LiveVoiceConnection {
  /** true si se aceptó (mandado ya o encolado); false si el socket no está abierto (mismo contrato que antes tenía `speak()` directo sobre el WebSocket). */
  enqueueOrSend(text: string): boolean;
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
 * proxy hacia Gemini es el `setup` inicial (con la config ya resuelta por
 * `CreateLiveSessionUseCase` del lado de `apps/web`, entregada acá vía
 * `LiveVoiceSessionStore`) más — desde el sistema básico de alertas —
 * los turnos sintéticos de `speak()`; todo lo demás sigue siendo relay de
 * bytes sin interpretar en el sentido de nunca transformarlo, aunque el
 * mensaje de Gemini -> browser sí se inspecciona al pasar (best-effort, sin
 * bloquear el relay si no es JSON parseable) para saber cuándo Gemini
 * terminó de hablar y así poder vaciar la cola de avisos — el browser
 * recibe exactamente los mismos bytes de siempre, sin cambios
 * (`useLiveSession.ts` no necesita saber que esto existe).
 */
export class GeminiLiveProxy {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  /** Ver `speak()` — última sesión Live activa por userId (una pestaña por usuario a la vez; una nueva conexión reemplaza a la anterior). */
  private readonly activeByUser = new Map<string, LiveVoiceConnection>();

  constructor(
    private readonly sessionStore: LiveVoiceSessionStore,
    private readonly apiKey: string,
    private readonly logger: LoggerPort,
    private readonly geminiWsUrl: string = DEFAULT_GEMINI_WS_URL,
    private readonly voice: string = DEFAULT_VOICE,
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

    // Cola de avisos de alerta (sistema básico de alertas) — `speak()` nunca
    // manda directo si Gemini está en medio de un turno (respondiendo, ya
    // sea a una conversación normal o a un aviso anterior): lo apila acá y
    // se vacía de a uno, recién cuando `serverContent.turnComplete` confirma
    // que el turno en curso terminó (ver el handler de "message" abajo).
    // Arranca en `false`: recién se marca "en curso" cuando efectivamente
    // vemos a Gemini empezar a responder (un `serverContent` sin
    // `turnComplete` todavía) — un `speak()` en el instante exacto entre
    // "el usuario dejó de hablar" y "Gemini mandó su primer chunk" puede
    // colarse y salir ya, ventana angosta aceptada a propósito (mismo
    // criterio "solución simple" del resto de esto).
    let awaitingTurnComplete = false;
    const speechQueue: string[] = [];

    function sendSpeechTurn(text: string): void {
      if (geminiSocket.readyState !== WebSocket.OPEN) return;
      geminiSocket.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: "user",
                parts: [{ text: `[ALERTA] Avisale ahora mismo al usuario, con tus propias palabras, de forma clara y directa: ${text}` }],
              },
            ],
            turnComplete: true,
          },
        }),
      );
      awaitingTurnComplete = true;
    }

    const connection: LiveVoiceConnection = {
      enqueueOrSend(text: string): boolean {
        if (geminiSocket.readyState !== WebSocket.OPEN) return false;
        if (awaitingTurnComplete) speechQueue.push(text);
        else sendSpeechTurn(text);
        return true;
      },
    };
    // Ver `speak()` — registrada apenas se abre la conexión saliente (no
    // hace falta esperar el "open"/setup: `enqueueOrSend()` ya chequea
    // readyState antes de mandar nada). Se saca al cerrar, y solo si sigue
    // siendo esta misma instancia (una reconexión más nueva del mismo
    // usuario ya pudo haber tomado su lugar en el mapa).
    if (config.userId) this.activeByUser.set(config.userId, connection);

    geminiSocket.on("open", () => {
      geminiSocket.send(
        JSON.stringify({
          setup: {
            model: `models/${config.model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.voice } } },
            },
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
      const raw = data.toString();
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(raw);

      // Best-effort: si no es JSON parseable (no debería pasar, Gemini
      // siempre manda JSON), el relay de arriba ya ocurrió — esto solo
      // actualiza el estado de la cola, nunca bloquea ni retrasa el relay.
      try {
        const parsed = JSON.parse(raw) as { serverContent?: { turnComplete?: boolean } };
        if (parsed.serverContent?.turnComplete) {
          awaitingTurnComplete = false;
          const next = speechQueue.shift();
          if (next !== undefined) sendSpeechTurn(next);
        } else if (parsed.serverContent) {
          awaitingTurnComplete = true;
        }
      } catch {
        // No JSON — nada que actualizar.
      }
    });

    browserSocket.on("close", () => geminiSocket.close());
    browserSocket.on("error", () => geminiSocket.close());

    geminiSocket.on("close", (code, reason) => {
      this.logger.info(`[GeminiLiveProxy] sesión con Gemini cerrada: ${code} ${reason.toString()}`);
      if (config.userId && this.activeByUser.get(config.userId) === connection) this.activeByUser.delete(config.userId);
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close();
    });
    geminiSocket.on("error", (error) => {
      this.logger.warn(`[GeminiLiveProxy] error de conexión con Gemini: ${error.message}`);
      if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close();
    });
  }

  /**
   * Avisa por voz a un usuario con una sesión Live activa ahora mismo
   * (sistema básico de alertas) — si Gemini está idle, manda el turno
   * sintético ya mismo; si está en medio de un turno (conversación normal o
   * un aviso anterior todavía sin terminar), lo encola y sale recién al
   * `turnComplete` de ese turno (ver `enqueueOrSend()`/`sendSpeechTurn()` en
   * `proxy()`) — evita el audio superpuesto de mandar un turno nuevo
   * mientras Gemini todavía está generando el anterior. La respuesta
   * hablada fluye de vuelta al browser por el relay normal, sin que
   * necesite ningún cambio. Devuelve `false` (nunca lanza) si el usuario no
   * tiene ninguna sesión Live abierta ahora mismo — el llamador decide qué
   * hacer con eso (Gateway ya mandó push/notificación de todos modos).
   */
  speak(userId: string, text: string): boolean {
    const connection = this.activeByUser.get(userId);
    if (!connection) return false;
    return connection.enqueueOrSend(text);
  }
}
