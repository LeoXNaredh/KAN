import { NextResponse } from "next/server";
import type { UserIdentity } from "@kan/core";
import { buildAuthUseCases } from "./composition";
import { extractBearerToken } from "./extractBearerToken";

export type RequireUserResult =
  | { ok: true; user: UserIdentity }
  | { ok: false; response: NextResponse };

/**
 * Gate de autenticación para Route Handlers (fix crítico: /api/chat,
 * /api/voice/*, /api/tools no rechazaban requests sin sesión). A diferencia
 * de getCurrentUserCached() — pensado para Server Components, solo lee la
 * sesión de cookies — este helper también verifica el Bearer explícito
 * (apps/mobile, ADR-029) pasándolo a GetCurrentUserUseCase.execute(), para
 * no romper el flujo de la app móvil: `client.auth.getUser(jwt)` valida ese
 * JWT puntual cuando viene, y cae a la sesión de cookies cuando no.
 */
export async function requireUser(request: Request): Promise<RequireUserResult> {
  try {
    const { getCurrentUser } = await buildAuthUseCases();
    const user = await getCurrentUser.execute(extractBearerToken(request));
    if (!user) {
      return { ok: false, response: NextResponse.json({ error: "Sesión requerida." }, { status: 401 }) };
    }
    return { ok: true, user };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Sesión requerida." }, { status: 401 }) };
  }
}
