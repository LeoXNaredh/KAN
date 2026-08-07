import { Router, type NextFunction, type Request, type Response } from "express";
import type { Gateway } from "@kan/gateway-core";
import { safeCompareToken } from "@kan/plugin-contract";

/**
 * API pública del Gateway (docs/12 §10), versionada desde ya (`/v1`) porque
 * es la misma superficie que en el futuro consumirán apps de terceros del
 * marketplace — hoy la consume únicamente `apps/web`.
 */
export function createRoutes(gateway: Gateway, internalToken: string): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!safeCompareToken(req.headers.authorization, `Bearer ${internalToken}`)) {
      res.status(401).json({ error: "No autorizado" });
      return;
    }
    next();
  });

  router.get("/v1/tools", (_req, res) => {
    res.json({ tools: gateway.listTools() });
  });

  router.post("/v1/tools/:name/execute", async (req, res) => {
    const result = await gateway.executeTool(req.params.name, req.body?.args ?? {});
    res.json(result);
  });

  router.get("/v1/agents", (_req, res) => {
    res.json({ agents: gateway.agentRegistry.list() });
  });

  router.get("/v1/audit", (_req, res) => {
    res.json({ entries: gateway.auditService.list() });
  });

  router.get("/v1/jobs", (_req, res) => {
    res.json({ jobs: gateway.scheduler.list() });
  });

  router.post("/v1/jobs", (req, res) => {
    const capabilityRef = req.body?.taskRequest?.capabilityRef;
    if (typeof capabilityRef !== "string" || !capabilityRef.trim()) {
      res.status(400).json({ error: "'taskRequest.capabilityRef' es requerido." });
      return;
    }

    try {
      const jobId = gateway.scheduler.schedule({
        taskRequest: { capabilityRef, input: req.body?.taskRequest?.input ?? {} },
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
