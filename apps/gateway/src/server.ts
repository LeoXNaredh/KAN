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
  SupabasePushTokenStore,
} from "@kan/supabase-adapter";
import {
  Gateway,
  GatewayBus,
  WsConnectionManager,
  NodeCronScheduler,
  JsonFileScheduledJobStore,
  ExpoNotificationService,
  ConsoleLogger,
  InMemoryEdgeTicketStore,
  LiveVoiceSessionStore,
  GeminiLiveProxy,
  GeminiDeviceResearchAdapter,
  DeviceEnrichmentService,
} from "@kan/gateway-core";
import { createRoutes } from "./http/routes";
import { createPairingRoutes } from "./http/pairingRoutes";

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
// Origin(es) permitido(s) para el camino de ticket del WS /edge (Simulador
// corriendo en apps/web) — a diferencia del camino de token nativo, acá el
// Origin sí es una prueba confiable porque JS de navegador no puede
// falsearlo. Sin esto configurado, toda conexión de navegador se rechaza
// con 403 (ver apps/gateway/.env.example).
const ALLOWED_WEB_ORIGINS = (process.env.KAN_WEB_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
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
// Efímero y en memoria a propósito (ver InMemoryEdgeTicketStore) — no es
// pairing, es la prueba de identidad de un solo uso para el Simulador
// corriendo en el navegador.
const edgeTicketStore = new InMemoryEdgeTicketStore();
const connectionManager = new WsConnectionManager(
  EDGE_TOKEN,
  MAX_WS_CONNECTIONS,
  pairingPort,
  edgeTicketStore,
  ALLOWED_WEB_ORIGINS,
);
const scheduledJobStore = new JsonFileScheduledJobStore(
  fileURLToPath(new URL("../data/scheduled-jobs.json", import.meta.url)),
);
const scheduler = new NodeCronScheduler(scheduledJobStore, logger);
// P7 (ADR-040): mismo cliente service_role, solo para leer los tokens Expo
// del dueño del job al dispararle su notificación (best-effort, ver
// ExpoNotificationService).
const pushTokenStore = new SupabasePushTokenStore(supabaseClient);
const notificationService = new ExpoNotificationService(pushTokenStore, logger);
const liveVoiceSessionStore = GEMINI_API_KEY ? new LiveVoiceSessionStore() : undefined;
const geminiLiveProxy =
  GEMINI_API_KEY && liveVoiceSessionStore
    ? new GeminiLiveProxy(liveVoiceSessionStore, GEMINI_API_KEY, logger)
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
// Antes de createRoutes(): esta ruta no lleva el token interno a propósito
// (apps/desktop nunca lo tiene, ver pairingRoutes.ts) — su única defensa es
// el código de pairing + un rate limit propio, más estricto.
app.use(createPairingRoutes(pairingPort));
app.use(
  createRoutes(
    gateway,
    INTERNAL_TOKEN,
    { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX },
    authPort,
    edgeTicketStore,
    liveVoiceSessionStore,
  ),
);

const httpServer = createServer(app);

httpServer.on("upgrade", (request, socket, head) => {
  // Con el camino de ticket, la URL trae query string (/edge?ticket=...) —
  // ya no alcanza comparar request.url completo, hay que mirar el pathname.
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
