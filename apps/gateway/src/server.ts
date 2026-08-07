import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { SupabaseAuditStore } from "@kan/supabase-adapter";
import {
  Gateway,
  GatewayBus,
  WsConnectionManager,
  NodeCronScheduler,
  JsonFileScheduledJobStore,
  ConsoleNotificationService,
  ConsoleLogger,
} from "@kan/gateway-core";
import { createRoutes } from "./http/routes";

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

const logger = new ConsoleLogger();
const bus = new GatewayBus();
const connectionManager = new WsConnectionManager(EDGE_TOKEN, MAX_WS_CONNECTIONS);
// service_role key (no anon): el Gateway no tiene sesión de usuario, así que
// no hay auth.uid() para las RLS policies — audit_entries no tiene ninguna
// policy para anon/authenticated a propósito (docs/16 P3, ADR-026).
const supabaseClient = createClient(requireEnv("KAN_SUPABASE_URL"), requireEnv("KAN_SUPABASE_SERVICE_ROLE_KEY"));
const auditStore = new SupabaseAuditStore(supabaseClient);
const scheduledJobStore = new JsonFileScheduledJobStore(
  fileURLToPath(new URL("../data/scheduled-jobs.json", import.meta.url)),
);
const scheduler = new NodeCronScheduler(scheduledJobStore, logger);
const notificationService = new ConsoleNotificationService(logger);

const gateway = new Gateway({ bus, connectionManager, auditStore, scheduler, notificationService });

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
app.use(createRoutes(gateway, INTERNAL_TOKEN, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX }));

const httpServer = createServer(app);

httpServer.on("upgrade", (request, socket, head) => {
  if (request.url === "/edge") {
    connectionManager.handleUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

gateway.bootstrap();

httpServer.listen(PORT, () => {
  logger.info(`[gateway] escuchando en :${PORT} (HTTP /v1/* + WS /edge)`);
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
