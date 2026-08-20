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
  SupabaseAgentGrantStore,
  SupabaseWebPushSubscriptionStore,
  SupabaseUserPreferencesStore,
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
  WebPushNotificationService,
  CompositeNotificationService,
  ConsoleLogger,
  LiveVoiceSessionStore,
  GeminiLiveProxy,
  GeminiDeviceResearchAdapter,
  DeviceEnrichmentService,
  InMemoryPluginPackageTicketStore,
  InMemoryEdgeTicketStore,
  ResendEmailService,
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
// Web Push (VAPID) — opcional, mismo criterio que GEMINI_API_KEY: sin esto,
// las alertas siguen avisando igual por Expo/app, solo sin este canal extra.
// Se generan una vez con `npx web-push generate-vapid-keys` (ver
// apps/gateway/.env.example) — nunca se generan acá.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
// Reporte diario por email (DailyReportService) — opcional, mismo criterio
// que VAPID_*: sin RESEND_API_KEY, el Gateway sigue funcionando igual,
// simplemente sin este reporte. RESEND_FROM_EMAIL cae al sandbox de Resend
// (onboarding@resend.dev) si no está configurada — alcance limitado hasta
// verificar un dominio propio en el dashboard de Resend (resend.com/domains).
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "KAN <onboarding@resend.dev>";
// URL pública de apps/web para el link "Ver en KAN" del reporte — cae al
// primer origin de KAN_WEB_ORIGIN si no está seteada aparte (mismo host,
// distinto propósito: KAN_WEB_ORIGIN es un allowlist de CORS, esto es un
// link de verdad para un humano).
const KAN_APP_URL = process.env.KAN_APP_URL || ALLOWED_WEB_ORIGINS[0] || "http://localhost:3000";

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
// Acceso multi-usuario (capa aditiva sobre el pairing 1:1) — mismo cliente
// service_role, sin credenciales nuevas.
const agentGrantStore = new SupabaseAgentGrantStore(supabaseClient);
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
// Web Push (mismo cliente service_role) — tabla separada de push_tokens
// (shape distinto: endpoint + par de claves, no un token simple). Fan-out
// con Expo vía CompositeNotificationService: Gateway.ts/AlertMonitor.ts
// siguen llamando a un único notificationService.notify(...), sin saber
// que hay más de un canal.
const webPushSubscriptionStore = new SupabaseWebPushSubscriptionStore(supabaseClient);
const webPushService =
  VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT
    ? new WebPushNotificationService(
        webPushSubscriptionStore,
        { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY, subject: VAPID_SUBJECT },
        logger,
      )
    : undefined;
if (!webPushService) {
  logger.warn("[gateway] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT no configuradas — el push al celular vía Web Push queda deshabilitado (Expo sigue funcionando igual).");
}
const notificationService = new CompositeNotificationService(
  [new ExpoNotificationService(pushTokenStore, logger), webPushService].filter((service) => service !== undefined),
);
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

// Reporte diario por email (DailyReportService) — mismo cliente
// service_role otra vez, misma tabla que ya usa /configuracion
// (personality/ttsVoice/plugin_config:*), namespaced con dos keys nuevas
// (dailyReportEnabled/dailyReportHour).
const userPreferencesStore = new SupabaseUserPreferencesStore(supabaseClient);
const emailService = RESEND_API_KEY ? new ResendEmailService(RESEND_API_KEY, RESEND_FROM_EMAIL, logger) : undefined;
if (!emailService) {
  logger.warn("[gateway] RESEND_API_KEY no configurada — el reporte diario por email queda deshabilitado.");
}
// Admin API real de Supabase (no el workaround de listUsers() paginado que
// usa SupabaseAgentGrantStore para email->userId — acá es al revés,
// userId->email, sí tiene endpoint directo).
async function resolveUserEmail(userId: string): Promise<string | undefined> {
  const { data, error } = await supabaseClient.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return undefined;
  return data.user.email;
}

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
  emailService,
  userPreferences: userPreferencesStore,
  resolveUserEmail,
  appUrl: KAN_APP_URL,
});

// Hidratación de acceso multi-usuario al arrancar (cubre un restart del
// Gateway) — fire-and-forget, best-effort: hasta que resuelva, un usuario
// invitado simplemente no ve el equipo compartido todavía (se corrige solo
// en cuanto termina, nunca bloquea el arranque del servidor HTTP/WS).
agentGrantStore
  .listAll()
  .then((grants) => {
    const byAgent = new Map<string, string[]>();
    for (const grant of grants) {
      const userIds = byAgent.get(grant.edgeAgentId) ?? [];
      userIds.push(grant.userId);
      byAgent.set(grant.edgeAgentId, userIds);
    }
    for (const [edgeAgentId, userIds] of byAgent) {
      gateway.agentRegistry.setGrantedUserIds(edgeAgentId, userIds);
    }
  })
  .catch((error) => logger.warn("[gateway] no se pudieron hidratar los accesos multi-usuario", { error }));

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
    agentGrantStore,
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
