import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import {
  SupabaseAuditStore,
  SupabaseAuthAdapter,
  SupabaseMemoryStore,
  SupabasePairingStore,
  SupabasePluginRegistry,
  SupabasePushTokenStore,
} from "@kan/supabase-adapter";
import {
  Gateway,
  GatewayBus,
  WsConnectionManager,
  NodeCronScheduler,
  JsonFileScheduledJobStore,
  JsonFileAgentRegistryStore,
  JsonFileTaskStore,
  JsonFileAlertRuleStore,
  ExpoNotificationService,
  ConsoleLogger,
  LiveVoiceSessionStore,
  GeminiLiveProxy,
  GeminiDeviceResearchAdapter,
  DeviceEnrichmentService,
  InMemoryPluginPackageTicketStore,
  InMemoryEdgeTicketStore,
} from "@kan/gateway-core";
import { createRoutes } from "./http/routes";
import { createPairingRoutes } from "./http/pairingRoutes";
import { createPluginRoutes } from "./http/pluginRoutes";

// Carga explícita del .env propio del Gateway, sin depender del cwd desde el
// que Turbo/pnpm invoquen el script (evita "Falta KAN_SUPABASE_URL" cuando el
// cwd no queda posicionado en apps/gateway).
loadEnv({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name}. Ver apps/gateway/.env.example.`);
  }
  return value;
}

const PORT = Number(process.env.PORT ?? 8787);
const EDGE_TOKEN = process.env.KAN_EDGE_TOKEN ?? "dev-token";
const INTERNAL_TOKEN = process.env.KAN_GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token";
// Rate limiting / cap de conexiones (docs/16 P6, ADR-025) — undefined deja
// que createRoutes()/WsConnectionManager usen sus defaults sensatos.
const RATE_LIMIT_WINDOW_MS = Number(process.env.KAN_GATEWAY_RATE_LIMIT_WINDOW_MS) || undefined;
const RATE_LIMIT_MAX = Number(process.env.KAN_GATEWAY_RATE_LIMIT_MAX) || undefined;
const MAX_WS_CONNECTIONS = Number(process.env.KAN_GATEWAY_MAX_WS_CONNECTIONS) || undefined;
// Fix de auditoría de backend #7: mismo criterio "undefined = default sensato".
const MAX_WS_MESSAGES_PER_SECOND = Number(process.env.KAN_GATEWAY_MAX_WS_MESSAGES_PER_SECOND) || undefined;
// Camino de ticket del WS /edge para el Simulador en el navegador (docs/19
// continuación) — lista de origins separados por coma; sin esto, toda
// conexión de navegador se rechaza con 403 (ver WsConnectionManager).
const ALLOWED_WEB_ORIGINS = (process.env.KAN_WEB_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
// Voz en tiempo real (ADR-044, rediseño vía proxy): opcional a propósito —
// sin esto, POST /v1/live-sessions responde 501 y el resto del Gateway
// sigue andando igual. Nunca sale de este proceso: GeminiLiveProxy es el
// único lugar que la usa, para abrir el WS saliente hacia Gemini.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const logger = new ConsoleLogger();
const bus = new GatewayBus();
// service_role key (no anon): el Gateway no tiene sesión de usuario, así que
// no hay auth.uid() para las RLS policies — audit_entries no tiene ninguna
// policy para anon/authenticated a propósito (docs/16 P3, ADR-026).
const supabaseClient = createClient(requireEnv("KAN_SUPABASE_URL"), requireEnv("KAN_SUPABASE_SERVICE_ROLE_KEY"));
const auditStore = new SupabaseAuditStore(supabaseClient);
// P2 incremento 1 (docs/19): mismo cliente, sin credenciales nuevas — solo
// para verificar el JWT que venga en X-User-Token, todavía sin autorización.
const authPort = new SupabaseAuthAdapter(supabaseClient);
// P2 incremento 3 (docs/19): mismo cliente otra vez — resuelve el ownerId de
// un Edge Agent ya vinculado a partir del pairingToken de su hello.
const pairingPort = new SupabasePairingStore(supabaseClient);
// ADR-056 (Fase 4): mismo cliente service_role otra vez, sin credenciales
// nuevas — catálogo cerrado de plugins sidecar oficiales + bucket privado
// de Storage. Ticket de descarga en memoria (mismo criterio que
// InMemoryEdgeTicketStore): mint y consume ocurren en la misma request.
const pluginRegistry = new SupabasePluginRegistry(supabaseClient);
const pluginPackageTicketStore = new InMemoryPluginPackageTicketStore();
// Sin persistencia a propósito (ver EdgeTicketPort/InMemoryEdgeTicketStore):
// un ticket vive segundos, el mismo proceso que lo emite es el que lo
// consume en el handshake del WS.
const edgeTicketStore = new InMemoryEdgeTicketStore();
const connectionManager = new WsConnectionManager(
  EDGE_TOKEN,
  MAX_WS_CONNECTIONS,
  pairingPort,
  edgeTicketStore,
  ALLOWED_WEB_ORIGINS,
  MAX_WS_MESSAGES_PER_SECOND,
);
const scheduledJobStore = new JsonFileScheduledJobStore(
  fileURLToPath(new URL("../data/scheduled-jobs.json", import.meta.url)),
);
const scheduler = new NodeCronScheduler(scheduledJobStore, logger);
// Fix de auditoría de backend #2: mismo patrón de archivo JSON local que
// scheduledJobStore arriba — AgentRegistry/TaskOrchestrator sobreviven un
// reinicio del Gateway en vez de arrancar vacíos cada vez.
const agentRegistryStore = new JsonFileAgentRegistryStore(
  fileURLToPath(new URL("../data/agent-registry.json", import.meta.url)),
);
const taskStore = new JsonFileTaskStore(fileURLToPath(new URL("../data/tasks.json", import.meta.url)));
// Sistema básico de alertas — mismo patrón de archivo JSON local que
// taskStore/scheduledJobStore arriba: sobrevive un reinicio del Gateway.
const alertRuleStore = new JsonFileAlertRuleStore(fileURLToPath(new URL("../data/alert-rules.json", import.meta.url)));
// P7 (ADR-040): mismo cliente service_role, solo para leer los tokens Expo
// del dueño del job al dispararle su notificación (best-effort, ver
// ExpoNotificationService).
const pushTokenStore = new SupabasePushTokenStore(supabaseClient);
const notificationService = new ExpoNotificationService(pushTokenStore, logger);
const liveVoiceSessionStore = GEMINI_API_KEY ? new LiveVoiceSessionStore() : undefined;
const geminiLiveProxy =
  GEMINI_API_KEY && liveVoiceSessionStore
    ? new GeminiLiveProxy(
        liveVoiceSessionStore,
        GEMINI_API_KEY,
        logger,
        undefined,
        process.env.GEMINI_LIVE_VOICE || undefined,
      )
    : undefined;
if (!GEMINI_API_KEY) {
  logger.warn("[gateway] GEMINI_API_KEY no configurada — la voz en tiempo real (ADR-044) queda deshabilitada.");
}

// Mismo cliente service_role otra vez — memoria multi-tenant, misma tabla
// que ya usa /configuracion (ADR-053). Siempre instanciado (barato, sin
// dependencia externa); lo que sí depende de GEMINI_API_KEY es quién la
// escribe automáticamente.
const memoryStore = new SupabaseMemoryStore(supabaseClient);
// Investigación automática de dispositivos nuevos (ADR-053) — mismo
// criterio condicional que geminiLiveProxy arriba: sin GEMINI_API_KEY,
// el Gateway sigue funcionando exactamente igual, solo sin esto.
const deviceResearchAdapter = GEMINI_API_KEY
  ? new GeminiDeviceResearchAdapter({ apiKey: GEMINI_API_KEY }, logger)
  : undefined;
const deviceEnrichmentService = deviceResearchAdapter
  ? new DeviceEnrichmentService(memoryStore, deviceResearchAdapter, notificationService, bus, logger)
  : undefined;

const gateway = new Gateway({
  bus,
  connectionManager,
  auditStore,
  scheduler,
  notificationService,
  deviceEnrichmentService,
  agentRegistryStore,
  taskStore,
  alertRuleStore,
  // Sin voz en tiempo real configurada (sin GEMINI_API_KEY), las alertas
  // siguen avisando igual por push/app — solo sin este canal extra.
  speakToUser: geminiLiveProxy ? (userId, text) => geminiLiveProxy.speak(userId, text) : undefined,
});

bus.on("agent.connected", ({ edgeAgentId }) => logger.info(`[gateway] Edge Agent conectado: ${edgeAgentId}`));
bus.on("agent.disconnected", ({ edgeAgentId }) => logger.info(`[gateway] Edge Agent desconectado: ${edgeAgentId}`));
bus.on("capability.synced", ({ edgeAgentId, count }) =>
  logger.info(`[gateway] ${count} capabilities sincronizadas desde ${edgeAgentId}`),
);
bus.on("task.dispatched", ({ taskId, capabilityRef }) =>
  logger.info(`[gateway] Tarea ${taskId} despachada: ${capabilityRef}`),
);
bus.on("task.completed", ({ taskId, result }) => logger.info(`[gateway] Tarea ${taskId} completada`, { result }));
bus.on("task.failed", ({ taskId, error }) => logger.error(`[gateway] Tarea ${taskId} falló: ${error}`));
bus.on("job.fired", ({ jobId, capabilityRef }) => logger.info(`[gateway] Job ${jobId} disparado: ${capabilityRef}`));
bus.on("job.step_failed", ({ jobId, capabilityRef, error }) =>
  logger.error(`[gateway] Job ${jobId} falló en el paso ${capabilityRef}: ${error}`),
);
bus.on("job.notification", ({ jobId, title }) => logger.info(`[gateway] Job ${jobId} notificó: ${title}`));

const app = express();
app.use(express.json());
// Sin autenticación a propósito — es lo único que un health check de
// Fly.io/Render puede llamar sin conocer KAN_GATEWAY_INTERNAL_TOKEN. No
// expone nada sensible, solo confirma que el proceso HTTP responde.
app.get("/healthz", (_req, res) => res.status(200).json({ ok: true }));
// Antes de createRoutes(): esta ruta no lleva el token interno a propósito
// (apps/desktop nunca lo tiene, ver pairingRoutes.ts) — su única defensa es
// el código de pairing + un rate limit propio, más estricto.
app.use(createPairingRoutes(pairingPort));
// Mismo criterio que createPairingRoutes (ADR-056, Fase 4): sin token
// interno, autenticado por el secreto de pairing que ya usa /v1/pairing/config.
app.use(createPluginRoutes(pairingPort, pluginRegistry, pluginPackageTicketStore));
app.use(
  createRoutes(
    gateway,
    INTERNAL_TOKEN,
    { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX },
    authPort,
    liveVoiceSessionStore,
    edgeTicketStore,
  ),
);

const httpServer = createServer(app);

httpServer.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", "http://internal").pathname;
  if (pathname === "/edge") {
    connectionManager.handleUpgrade(request, socket, head);
  } else if (pathname === "/live-voice" && geminiLiveProxy) {
    geminiLiveProxy.handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

gateway.bootstrap();

httpServer.listen(PORT, () => {
  logger.info(`[gateway] escuchando en :${PORT} (HTTP /v1/* + WS /edge${geminiLiveProxy ? " + /live-voice" : ""})`);
});

function shutdown(signal: string): void {
  logger.info(`[gateway] ${signal} recibido, cerrando...`);
  gateway.shutdown();
  httpServer.close(() => process.exit(0));
  // Si el cierre ordenado no termina a tiempo (conexiones colgadas), forzar salida.
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (error) => {
  logger.error("[gateway] excepción no capturada", { error });
});

process.on("unhandledRejection", (reason) => {
  logger.error("[gateway] promesa rechazada sin manejar", { reason });
});
