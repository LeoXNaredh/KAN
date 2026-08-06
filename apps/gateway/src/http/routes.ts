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

  return router;
}
