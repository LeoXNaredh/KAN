import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type { Gateway } from "@kan/gateway-core";
import type { AuthPort } from "@kan/core";
import { safeCompareToken } from "@kan/plugin-contract";
import { createUserAuthMiddleware } from "./userAuthMiddleware";

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
): Router {
  const router = Router();

  // Antes del chequeo de token: también acota intentos de fuerza bruta
  // contra el token interno, no solo tráfico ya autenticado.
  router.use(
    rateLimit({
      windowMs: rateLimitOptions?.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
      limit: rateLimitOptions?.max ?? DEFAULT_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
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

  router.get("/v1/agents", (req, res) => {
    res.json({ agents: gateway.agentRegistry.list(req.userId) });
  });

  router.get("/v1/audit", async (req, res) => {
    res.json({ entries: await gateway.auditService.list({ userId: req.userId }) });
  });

  router.get("/v1/jobs", (_req, res) => {
    res.json({ jobs: gateway.scheduler.list() });
  });

  router.post("/v1/jobs", (req, res) => {
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
      });
      res.status(201).json({ jobId });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Error desconocido" });
    }
  });

  router.delete("/v1/jobs/:id", (req, res) => {
    gateway.scheduler.cancel(req.params.id);
    res.status(204).end();
  });

  return router;
}
