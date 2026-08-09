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

  // Acotado a esta ruta (no `router.use(rateLimit(...))` a secas): este
  // router se monta en server.ts con `app.use(createPairingRoutes(...))`,
  // sin prefijo — un `router.use()` sin path ahí adentro corre para
  // CUALQUIER request que llegue al Gateway, no solo para pairing. Así
  // terminaba estrangulando con 10 req/60s también /v1/edge-tickets y el
  // resto de /v1/*, que tienen su propio rate limit (más permisivo) en
  // createRoutes().
  router.use(
    "/v1/pairing/claim",
    rateLimit({
      windowMs: PAIRING_RATE_LIMIT_WINDOW_MS,
      limit: PAIRING_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Demasiados intentos, espera un momento." },
    }),
  );
  // Mismo límite estricto que /claim — a diferencia de /claim (código corto,
  // sí adivinable a fuerza bruta), acá el secreto ya es largo/aleatorio, pero
  // igual conviene un tope defensivo: esta ruta queda fuera del rate limit
  // general de createRoutes() (createPairingRoutes se monta antes, sin el
  // token interno) así que sin esto no tendría ningún límite.
  router.use(
    "/v1/pairing/config",
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

    let result;
    try {
      result = await pairingPort.claim(pairingCode, edgeAgentId);
    } catch (error) {
      // claim() lanza a propósito ante un fallo real (ej. tabla faltante,
      // conexión caída) — distinto de "código inválido" (undefined, ver
      // abajo). Sin este catch la promesa queda rechazada sin manejar y el
      // request se cuelga para siempre (nunca llega ningún res.status/json).
      res.status(500).json({ error: error instanceof Error ? error.message : "Error desconocido" });
      return;
    }
    if (!result) {
      res.status(400).json({ error: "Código de pairing inválido, vencido o ya usado." });
      return;
    }
    res.json(result);
  });

  // GET, no POST: es una consulta idempotente (el Edge Agent la puede pedir
  // cuantas veces quiera, ej. al arrancar o desde un botón "Sincronizar
  // configuración") — a diferencia de /claim, que consume el código.
  // Autenticada por el secreto de pairing en un header (nunca en la URL,
  // para no dejarlo en logs de acceso) — mismo secreto que ya usa el hello
  // por WS (`resolveOwner`), ahora también válido acá.
  router.get("/v1/pairing/config", async (req, res) => {
    const secret = typeof req.headers["x-pairing-secret"] === "string" ? req.headers["x-pairing-secret"] : "";
    const edgeAgentId = typeof req.headers["x-edge-agent-id"] === "string" ? req.headers["x-edge-agent-id"] : "";
    if (!secret || !edgeAgentId) {
      res.status(400).json({ error: "Se requiere el header 'X-Pairing-Secret' y 'X-Edge-Agent-Id'." });
      return;
    }

    let pluginConfig: Record<string, string> | undefined;
    try {
      pluginConfig = await pairingPort.getPluginConfig(secret, edgeAgentId);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Error desconocido" });
      return;
    }
    if (pluginConfig === undefined) {
      res.status(401).json({ error: "Secreto de pairing inválido." });
      return;
    }
    res.json({ pluginConfig });
  });

  return router;
}
