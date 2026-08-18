import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type { EdgeTicketPort, Gateway, LiveVoiceSessionStore } from "@kan/gateway-core";
import type { AuthPort } from "@kan/core";
import { safeCompareToken } from "@kan/plugin-contract";
import { createUserAuthMiddleware } from "./userAuthMiddleware";
import { rateLimitKey } from "./rateLimitKey";

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
}

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
/** Cómodo frente al tráfico real (polling del Dashboard cada 15s + varias llamadas de function-calling por turno de chat), sin dejar de acotar abuso (docs/16 P6, ADR-025). */
const DEFAULT_RATE_LIMIT_MAX = 120;

/**
 * API pública del Gateway (docs/12 §10), versionada desde ya (`/v1`) porque
 * es la misma superficie que en el futuro consumirán apps de terceros del
 * marketplace — hoy la consume únicamente `apps/web`.
 */
export function createRoutes(
  gateway: Gateway,
  internalToken: string,
  rateLimitOptions?: RateLimitOptions,
  authPort?: AuthPort,
  liveVoiceSessionStore?: LiveVoiceSessionStore,
  edgeTicketStore?: EdgeTicketPort,
): Router {
  const router = Router();

  // Antes del chequeo de token: también acota intentos de fuerza bruta
  // contra el token interno, no solo tráfico ya autenticado. Por eso
  // `rateLimitKey` decodifica el userId del JWT ella misma (en vez de
  // esperar a `createUserAuthMiddleware`, que corre después) — sin eso,
  // todo el tráfico de apps/web (un único origen server-to-server) comparte
  // la misma IP y por lo tanto el mismo presupuesto de 120 req/min entre
  // toda la base de usuarios (fix de auditoría de backend #4). Con
  // X-User-Token, cada usuario tiene su propio balde; sin token, cae a la
  // IP como antes.
  router.use(
    rateLimit({
      windowMs: rateLimitOptions?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
      limit: rateLimitOptions?.max ?? DEFAULT_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: rateLimitKey,
      message: { error: "Demasiadas solicitudes, intenta de nuevo en un momento." },
    }),
  );

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!safeCompareToken(req.headers.authorization, `Bearer ${internalToken}`)) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }
    next();
  });

  router.use(createUserAuthMiddleware(authPort));

  router.get("/v1/whoami", (req, res) => {
    res.json({ userId: req.userId ?? null, email: req.userEmail ?? null });
  });

  router.get("/v1/tools", (req, res) => {
    res.json({ tools: gateway.listTools(req.userId) });
  });

  router.post("/v1/tools/:name/execute", async (req, res) => {
    const result = await gateway.executeTool(req.params.name, req.body?.args ?? {}, req.userId);
    res.json(result);
  });

  // Resuelve una confirmación pendiente (irreversible-material/safety-critical,
  // ADR-059) — hasta este incremento solo `apps/desktop` podía hacerlo, vía
  // IPC local. La autorización por owner vive en `Gateway.resolveConfirmation()`.
  router.post("/v1/confirmations/:id/resolve", async (req, res) => {
    if (typeof req.body?.approved !== "boolean") {
      res.status(400).json({ error: "Se requiere 'approved' como boolean." });
      return;
    }
    const result = await gateway.resolveConfirmation(req.params.id, req.body.approved, req.userId);
    if (!result) {
      res.status(404).json({ error: "No se encontró la confirmación — puede haber expirado, ya haber sido resuelta, o el Gateway se reinició mientras estaba pendiente." });
      return;
    }
    res.json(result);
  });

  router.get("/v1/agents", (req, res) => {
    res.json({ agents: gateway.agentRegistry.list(req.userId) });
  });

  router.get("/v1/audit", async (req, res) => {
    res.json({ entries: await gateway.auditService.list({ userId: req.userId }) });
  });

  router.get("/v1/jobs", (req, res) => {
    // Fix de auditoría de backend: `scheduler.list()` no filtraba por
    // usuario — cualquier sesión veía los recordatorios de todo el mundo
    // (cron schedules, inputs de la capability, texto de la notificación).
    // Mismo criterio que ya usaba DELETE /v1/jobs/:id (autorización por
    // owner, ADR-033 reabierto puntualmente): un job sin `createdBy`
    // (legacy, o creado sin sesión) sigue siendo visible para cualquiera,
    // igual que antes; uno con `createdBy` solo lo ve su dueño.
    const jobs = gateway.scheduler.list().filter((job) => job.createdBy === undefined || job.createdBy === req.userId);
    res.json({ jobs });
  });

  router.post("/v1/jobs", (req, res) => {
    // Fix de auditoría de backend: sin esto, un job creado sin sesión
    // resuelta quedaba con `createdBy: undefined` — indistinguible de un
    // job legacy, y por lo tanto abierto para que cualquiera lo cancele
    // (ver el criterio de DELETE arriba). Programar un recordatorio ya
    // requiere sesión activa en el producto real (apps/web siempre manda
    // X-User-Token); esto solo lo hace explícito acá.
    if (!req.userId) {
      res.status(401).json({ error: "Se requiere sesión activa para programar un recordatorio." });
      return;
    }

    const rawSteps = Array.isArray(req.body?.steps) ? req.body.steps : [];
    const steps: Array<{ capabilityRef: string; input: unknown }> = [];
    for (const rawStep of rawSteps) {
      const capabilityRef = rawStep?.capabilityRef;
      if (typeof capabilityRef !== "string" || !capabilityRef.trim()) {
        res.status(400).json({ error: "Cada paso ('steps') necesita 'capabilityRef'." });
        return;
      }
      steps.push({ capabilityRef, input: rawStep?.input ?? {} });
    }
    if (steps.length === 0) {
      res.status(400).json({ error: "El job necesita al menos un paso ('steps')." });
      return;
    }

    const rawNotification = req.body?.notification;
    const notification =
      rawNotification && typeof rawNotification.title === "string" && typeof rawNotification.body === "string"
        ? { title: rawNotification.title, body: rawNotification.body }
        : undefined;

    try {
      const jobId = gateway.scheduler.schedule({
        steps,
        notification,
        cron: typeof req.body?.cron === "string" ? req.body.cron : undefined,
        runAt: typeof req.body?.runAt === "string" ? req.body.runAt : undefined,
        createdBy: req.userId,
      });
      res.status(201).json({ jobId });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Error desconocido" });
    }
  });

  router.delete("/v1/jobs/:id", (req, res) => {
    // Mismo criterio de ownership que executeTool() (Gateway.ts): un job sin
    // createdBy (creado antes de ADR-040, o sin sesión al crearlo) queda
    // abierto para cualquiera, igual que hoy; uno con createdBy solo lo
    // puede cancelar su dueño. ADR-033 dejaba ScheduledJob deliberadamente
    // fuera de la autorización por owner -- esto lo reabre puntualmente
    // para DELETE, que es la única operación destructiva sobre un job.
    const job = gateway.scheduler.list().find((candidate) => candidate.id === req.params.id);
    if (job && job.createdBy !== undefined && job.createdBy !== req.userId) {
      gateway.auditService.record({
        actor: "user",
        action: "job.cancel.denied",
        subject: req.params.id,
        userId: req.userId,
        metadata: { requestingUserId: req.userId, ownerId: job.createdBy },
      });
      res.status(403).json({ error: "No autorizado: este recordatorio pertenece a otro usuario." });
      return;
    }

    gateway.scheduler.cancel(req.params.id);
    res.status(204).end();
  });

  // Registra la config (system prompt + tools ya resueltos por
  // CreateLiveSessionUseCase en apps/web) para una sesión de voz en tiempo
  // real (ADR-044) — devuelve un sessionId de un solo uso, no la config en
  // sí. El browser lo usa para conectar el WS /live-voice del Gateway
  // (GeminiLiveProxy), nunca habla directo con Gemini.
  router.post("/v1/live-sessions", (req, res) => {
    if (!liveVoiceSessionStore) {
      res.status(501).json({ error: "El Gateway no tiene configurada la voz en tiempo real (falta GEMINI_API_KEY)." });
      return;
    }
    const model = req.body?.model;
    const systemPrompt = req.body?.systemPrompt;
    const tools = Array.isArray(req.body?.tools) ? req.body.tools : [];
    if (typeof model !== "string" || !model.trim() || typeof systemPrompt !== "string" || !systemPrompt.trim()) {
      res.status(400).json({ error: "Se requieren 'model' y 'systemPrompt' como strings no vacíos." });
      return;
    }
    const { sessionId, expiresAt } = liveVoiceSessionStore.register({ model, systemPrompt, tools });
    res.status(201).json({ sessionId, expiresAt });
  });

  // Prueba de identidad de un solo uso para el camino de navegador del WS
  // /edge (docs/19 continuación, ver EdgeTicketPort) — requiere sesión ya
  // verificada por createUserAuthMiddleware() arriba; sin req.userId no hay
  // a nombre de quién emitir el ticket.
  router.post("/v1/edge-tickets", (req, res) => {
    if (!edgeTicketStore) {
      res.status(501).json({ error: "El Gateway no tiene configurado el camino de navegador para el Edge Agent." });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: "Se requiere sesión activa para pedir un ticket de conexión." });
      return;
    }
    const { ticket, expiresAt } = edgeTicketStore.mint(req.userId);
    res.status(201).json({ ticket, expiresAt });
  });

  return router;
}
