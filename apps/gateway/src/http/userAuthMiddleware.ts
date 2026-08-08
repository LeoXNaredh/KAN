import type { NextFunction, Request, Response } from "express";
import type { AuthPort } from "@kan/core";

/**
 * Extrae la identidad de usuario desde `X-User-Token` (P2 incremento 1,
 * docs/19). No reemplaza el chequeo del secreto interno (`Authorization`) —
 * son capas distintas. Sin `authPort` configurado o sin el header, no hace
 * nada: mismo comportamiento que antes de este middleware, a propósito
 * (docs/19 §6, incremento 1 no cambia autorización, solo identidad).
 */
export function createUserAuthMiddleware(authPort?: AuthPort) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!authPort) {
      next();
      return;
    }

    const token = req.headers["x-user-token"];
    if (!token || typeof token !== "string") {
      next();
      return;
    }

    try {
      const user = await authPort.getCurrentUser(token);
      if (!user) {
        res.status(401).json({ error: "Token de usuario inválido" });
        return;
      }
      req.userId = user.userId;
      req.userEmail = user.email;
      next();
    } catch {
      res.status(401).json({ error: "Token de usuario inválido" });
    }
  };
}
