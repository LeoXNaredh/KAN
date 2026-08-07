import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  Gateway,
  GatewayBus,
  WsConnectionManager,
  JsonlAuditStore,
  NodeCronScheduler,
  JsonFileScheduledJobStore,
  ConsoleNotificationService,
} from "@kan/gateway-core";
import { createRoutes } from "./http/routes";

const PORT = Number(process.env.PORT ?? 8787);
const EDGE_TOKEN = process.env.KAN_EDGE_TOKEN ?? "dev-token";
const INTERNAL_TOKEN = process.env.KAN_GATEWAY_INTERNAL_TOKEN ?? "dev-internal-token";

const bus = new GatewayBus();
const connectionManager = new WsConnectionManager(EDGE_TOKEN);
const auditStore = new JsonlAuditStore(fileURLToPath(new URL("../data/audit.jsonl", import.meta.url)));
const scheduledJobStore = new JsonFileScheduledJobStore(
  fileURLToPath(new URL("../data/scheduled-jobs.json", import.meta.url)),
);
const scheduler = new NodeCronScheduler(scheduledJobStore);
const notificationService = new ConsoleNotificationService();

const gateway = new Gateway({ bus, connectionManager, auditStore, scheduler, notificationService });

bus.on("agent.connected", ({ edgeAgentId }) => console.log(`[gateway] Edge Agent conectado: ${edgeAgentId}`));
bus.on("agent.disconnected", ({ edgeAgentId }) => console.log(`[gateway] Edge Agent desconectado: ${edgeAgentId}`));
bus.on("capability.synced", ({ edgeAgentId, count }) =>
  console.log(`[gateway] ${count} capabilities sincronizadas desde ${edgeAgentId}`),
);
bus.on("task.dispatched", ({ taskId, capabilityRef }) =>
  console.log(`[gateway] Tarea ${taskId} despachada: ${capabilityRef}`),
);
bus.on("task.completed", ({ taskId, result }) => console.log(`[gateway] Tarea ${taskId} completada:`, result));
bus.on("task.failed", ({ taskId, error }) => console.error(`[gateway] Tarea ${taskId} falló: ${error}`));
bus.on("job.fired", ({ jobId, capabilityRef }) => console.log(`[gateway] Job ${jobId} disparado: ${capabilityRef}`));
bus.on("job.step_failed", ({ jobId, capabilityRef, error }) =>
  console.error(`[gateway] Job ${jobId} falló en el paso ${capabilityRef}: ${error}`),
);
bus.on("job.notification", ({ jobId, title }) => console.log(`[gateway] Job ${jobId} notificó: ${title}`));

const app = express();
app.use(express.json());
app.use(createRoutes(gateway, INTERNAL_TOKEN));

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
  console.log(`[gateway] escuchando en :${PORT} (HTTP /v1/* + WS /edge)`);
});

function shutdown(signal: string): void {
  console.log(`[gateway] ${signal} recibido, cerrando...`);
  gateway.shutdown();
  httpServer.close(() => process.exit(0));
  // Si el cierre ordenado no termina a tiempo (conexiones colgadas), forzar salida.
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (error) => {
  console.error("[gateway] excepción no capturada:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[gateway] promesa rechazada sin manejar:", reason);
});
