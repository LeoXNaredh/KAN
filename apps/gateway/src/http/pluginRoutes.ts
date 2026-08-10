import type { Request, Response } from "express";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { PairingPort } from "@kan/core";
import type { PluginPackageTicketPort, PluginRegistryPort } from "@kan/gateway-core";

const PLUGIN_RATE_LIMIT_WINDOW_MS = 60_000;
/** Mismo criterio estricto que pairingRoutes.ts (docs/16 P6): esta ruta no lleva el token interno, solo el secreto de pairing. */
const PLUGIN_RATE_LIMIT_MAX = 10;
/** Vida de la signed URL de descarga — igual al TTL de `PluginPackageTicketPort` (5 min, hay una descarga HTTP real de por medio). */
const DOWNLOAD_URL_TTL_SECONDS = 300;

async function resolveOwnerOrRespond(req: Request, res: Response, pairingPort: PairingPort): Promise<string | undefined> {
  const secret = typeof req.headers["x-pairing-secret"] === "string" ? req.headers["x-pairing-secret"] : "";
  const edgeAgentId = typeof req.headers["x-edge-agent-id"] === "string" ? req.headers["x-edge-agent-id"] : "";
  if (!secret || !edgeAgentId) {
    res.status(400).json({ error: "Se requiere el header 'X-Pairing-Secret' y 'X-Edge-Agent-Id'." });
    return undefined;
  }

  let ownerId: string | undefined;
  try {
    ownerId = await pairingPort.resolveOwner(secret, edgeAgentId);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Error desconocido" });
    return undefined;
  }
  if (!ownerId) {
    res.status(401).json({ error: "Secreto de pairing inválido." });
    return undefined;
  }
  return ownerId;
}

/**
 * Catálogo y descarga de plugins sidecar bajo demanda (ADR-056, Fase 4).
 * Mismo criterio de auth que `pairingRoutes.ts` (secreto de pairing por
 * header, no el token interno — `apps/desktop` nunca tiene
 * `KAN_GATEWAY_INTERNAL_TOKEN`) y mismo rate limit estricto (única defensa
 * de esta ruta, igual que /v1/pairing/*).
 */
export function createPluginRoutes(
  pairingPort: PairingPort,
  pluginRegistry: PluginRegistryPort,
  ticketPort: PluginPackageTicketPort,
): Router {
  const router = Router();

  router.use(
    "/v1/plugins",
    rateLimit({
      windowMs: PLUGIN_RATE_LIMIT_WINDOW_MS,
      limit: PLUGIN_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Demasiados intentos, espera un momento." },
    }),
  );

  router.get("/v1/plugins/catalog", async (req, res) => {
    const ownerId = await resolveOwnerOrRespond(req, res, pairingPort);
    if (!ownerId) return;

    try {
      const catalog = await pluginRegistry.listCatalog();
      res.json({ catalog });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Error desconocido" });
    }
  });

  router.post("/v1/plugins/:id/download", async (req, res) => {
    const ownerId = await resolveOwnerOrRespond(req, res, pairingPort);
    if (!ownerId) return;

    const pluginId = req.params.id;
    let ref;
    try {
      ref = await pluginRegistry.getDownloadRef(pluginId);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Error desconocido" });
      return;
    }
    if (!ref) {
      res.status(404).json({ error: `Plugin "${pluginId}" no encontrado en el catálogo.` });
      return;
    }

    // mint()+consume() en la misma request a propósito (ADR-056): deja el
    // seam de PluginPackageTicketPort listo para una variante futura donde
    // el mint y el consume ocurran en requests distintas, sin rediseñarlo.
    const { ticket } = ticketPort.mint(ownerId, pluginId);
    const claim = ticketPort.consume(ticket);
    if (!claim) {
      res.status(500).json({ error: "No se pudo autorizar la descarga." });
      return;
    }

    try {
      const downloadUrl = await pluginRegistry.createSignedDownloadUrl(ref.storageObjectPath, DOWNLOAD_URL_TTL_SECONDS);
      const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString();
      res.json({ downloadUrl, expiresAt, manifest: ref.manifest });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Error desconocido" });
    }
  });

  return router;
}
