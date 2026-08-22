import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { PairingPort } from "@kan/core";
import type { DeviceSnapshotStorePort, DeviceSnapshotTicketPort } from "@kan/gateway-core";
import type { ProjectBackupType } from "@kan/plugin-contract";

const SNAPSHOT_RATE_LIMIT_WINDOW_MS = 60_000;
/** Mismo criterio estricto que pluginRoutes.ts/pairingRoutes.ts (docs/16 P6): esta ruta no lleva el token interno, solo el secreto de pairing. */
const SNAPSHOT_RATE_LIMIT_MAX = 20;
/** Vida de la signed URL de descarga (para restore) — igual criterio que pluginRoutes.ts, hay una transferencia HTTP real de por medio. */
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

function isBackupType(value: unknown): value is ProjectBackupType {
  return value === "source" || value === "binary" || value === "config";
}

/**
 * Subida/descarga de snapshots de backup/restore de proyecto (docs/06),
 * llamada por el Edge Agent — mismo criterio de auth que `pluginRoutes.ts`
 * (secreto de pairing por header, no el token interno) y mismo rate limit
 * estricto. Las rutas de lectura/borrado para `apps/web` (autenticadas por
 * JWT de usuario) viven en `routes.ts`, no acá — mismo criterio que
 * `/v1/plugins/catalog` (edge-agent) vs `/v1/capabilities` (usuario).
 */
export function createSnapshotRoutes(
  pairingPort: PairingPort,
  deviceSnapshotStore: DeviceSnapshotStorePort,
  ticketPort: DeviceSnapshotTicketPort,
): Router {
  const router = Router();

  router.use(
    "/v1/devices",
    rateLimit({
      windowMs: SNAPSHOT_RATE_LIMIT_WINDOW_MS,
      limit: SNAPSHOT_RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Demasiados intentos, espera un momento." },
    }),
  );

  router.post("/v1/devices/:deviceId/snapshots/upload-url", async (req, res) => {
    const ownerId = await resolveOwnerOrRespond(req, res, pairingPort);
    if (!ownerId) return;

    const deviceId = req.params.deviceId;
    const backupType = req.body?.backupType;
    if (!isBackupType(backupType)) {
      res.status(400).json({ error: "'backupType' debe ser 'source', 'binary' o 'config'." });
      return;
    }

    // mint()+consume() en la misma request, mismo criterio que pluginRoutes.ts.
    const { ticket } = ticketPort.mint(ownerId, deviceId);
    const claim = ticketPort.consume(ticket);
    if (!claim) {
      res.status(500).json({ error: "No se pudo autorizar la subida." });
      return;
    }

    const extension = backupType === "binary" ? "bin" : "json";
    const storageObjectPath = `${ownerId}/${deviceId}/${randomUUID()}.${extension}`;

    try {
      const target = await deviceSnapshotStore.createSignedUploadUrl(storageObjectPath);
      res.json({ ...target, storageObjectPath });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Error desconocido" });
    }
  });

  router.post("/v1/devices/:deviceId/snapshots/confirm", async (req, res) => {
    const ownerId = await resolveOwnerOrRespond(req, res, pairingPort);
    if (!ownerId) return;
    const edgeAgentId = req.headers["x-edge-agent-id"] as string;

    const { storageObjectPath, backupType, deviceName, deviceKind, label, sizeBytes, fileCount } = req.body ?? {};
    if (typeof storageObjectPath !== "string" || !isBackupType(backupType) || typeof deviceKind !== "string") {
      res.status(400).json({ error: "Faltan campos requeridos ('storageObjectPath', 'backupType', 'deviceKind')." });
      return;
    }
    // Confía solo en storageObjectPath ya devuelto por /upload-url para este mismo owner — evita que el body registre un objeto de otro usuario.
    if (!storageObjectPath.startsWith(`${ownerId}/`)) {
      res.status(403).json({ error: "'storageObjectPath' no pertenece a este usuario." });
      return;
    }

    try {
      const record = await deviceSnapshotStore.create({
        userId: ownerId,
        edgeAgentId,
        deviceId: req.params.deviceId,
        deviceName: typeof deviceName === "string" ? deviceName : undefined,
        deviceKind,
        backupType,
        label: typeof label === "string" ? label : undefined,
        storageObjectPath,
        sizeBytes: typeof sizeBytes === "number" ? sizeBytes : undefined,
        fileCount: typeof fileCount === "number" ? fileCount : undefined,
      });
      res.status(201).json({ snapshot: record });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Error desconocido" });
    }
  });

  router.get("/v1/devices/:deviceId/snapshots/:id/download-url", async (req, res) => {
    const ownerId = await resolveOwnerOrRespond(req, res, pairingPort);
    if (!ownerId) return;

    try {
      const record = await deviceSnapshotStore.get(req.params.id);
      if (!record || record.userId !== ownerId || record.deviceId !== req.params.deviceId) {
        res.status(404).json({ error: "Snapshot no encontrado." });
        return;
      }
      const { ticket } = ticketPort.mint(ownerId, req.params.deviceId);
      const claim = ticketPort.consume(ticket);
      if (!claim) {
        res.status(500).json({ error: "No se pudo autorizar la descarga." });
        return;
      }
      const downloadUrl = await deviceSnapshotStore.createSignedDownloadUrl(record.storageObjectPath, DOWNLOAD_URL_TTL_SECONDS);
      const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString();
      res.json({ downloadUrl, expiresAt, backupType: record.backupType });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Error desconocido" });
    }
  });

  return router;
}
