import { NextResponse } from "next/server";
import { DEVICE_DISPLAY_NAME_KEY_PREFIX } from "@kan/core";
import { buildMemoryUseCases } from "@/lib/memory/composition";
import { requireUser } from "@/lib/auth/requireUser";

/**
 * Nombres personalizados de dispositivos (nombres "más humanos") — filtra
 * las memorias de categoría "dispositivos" a solo las que KAN guardó vía la
 * convención `deviceDisplayNameMemoryKey` (ver packages/core/deviceNaming.ts
 * y el system prompt de SendMessageUseCase), y las devuelve ya mapeadas
 * `nombre técnico -> nombre elegido` para que la UI las use como lookup
 * directo sin conocer el prefijo de la clave.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    const { listMemories } = await buildMemoryUseCases();
    const memories = await listMemories.execute(auth.user.userId, "dispositivos");

    const names: Record<string, string> = {};
    for (const memory of memories) {
      if (!memory.key.startsWith(DEVICE_DISPLAY_NAME_KEY_PREFIX)) continue;
      const rawName = memory.key.slice(DEVICE_DISPLAY_NAME_KEY_PREFIX.length);
      if (rawName && typeof memory.value === "string") names[rawName] = memory.value;
    }

    return NextResponse.json({ names });
  } catch (error) {
    console.error("[/api/memories/device-names] error inesperado:", error);
    return NextResponse.json({ names: {} });
  }
}
