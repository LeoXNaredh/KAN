import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { PairingPort } from "@kan/core";

const PAIRING_RATE_LIMIT_WINDOW_MS = 60_000;
/** Más estricto que el rate limit general (docs/16 P6): acá el código de pairing es la única defensa, no hay token interno. */
const PAIRING_RATE_LIMIT_MAX = 10;

/**
 * Ruta de pairing del Edge Agent (docs/19 P2, incremento 3). Router
 * separado de `createRoutes()` — a propósito, no lleva el token interno
 * (`KAN_GATEWAY_INTERNAL_TOKEN`): `apps/desktop` nunca lo tiene, y meter un
 * secreto de servidor en un cliente distribuido sería el mismo error que
 * este mecanismo busca evitar en primer lugar.
 */
export function createPairingRoutes(pairingPort: PairingPort): Router {
  const router = Router();

  router.use(
    rateLimit({
      windowMs: PAIRING_RATE_LIMIT_WINDOW_MS,
      limit: PAIRING_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Demasiados intentos, espera un momento." },
    }),
  );

  router.post("/v1/pairing/claim", async (req, res) => {
    const pairingCode = typeof req.body?.pairingCode === "string" ? req.body.pairingCode.trim() : "";
    const edgeAgentId = typeof req.body?.edgeAgentId === "string" ? req.body.edgeAgentId.trim() : "";
    if (!pairingCode || !edgeAgentId) {
      res.status(400).json({ error: "Se requiere 'pairingCode' y 'edgeAgentId'." });
      return;
    }

    const result = await pairingPort.claim(pairingCode, edgeAgentId);
    if (!result) {
      res.status(400).json({ error: "Código de pairing inválido, vencido o ya usado." });
      return;
    }
    res.json(result);
  });

  return router;
}
