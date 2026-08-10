import { getAccessToken } from "../supabase/getAccessToken";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

/**
 * Sube el audio grabado a /api/voice/transcribe (docs/18, incremento 4) —
 * deliberadamente vía XMLHttpRequest, NO `fetch`/`expo/fetch` (ADR-032):
 * `expo/fetch` tiene bugs conocidos y no confirmados como resueltos en
 * SDK 57 al subir `FormData` con archivos en nativo. `XMLHttpRequest` es
 * el mecanismo estable de RN para esto, sin relación con esos bugs.
 * Manda `Authorization: Bearer <token>` (ADR-029, mismo patrón que
 * /api/chat en index.tsx) — la ruta ahora exige sesión válida (fix
 * crítico de auditoría de backend).
 */
export async function uploadAudio(uri: string): Promise<string> {
  const accessToken = await getAccessToken();

  return new Promise((resolve, reject) => {
    const formData = new FormData();
    // Shape clásico de RN para adjuntar un archivo local a FormData — no es
    // un objeto File/Blob real, es el patrón que React Native reconoce.
    formData.append("audio", {
      uri,
      name: "audio.m4a",
      type: "audio/m4a",
    } as unknown as Blob);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/api/voice/transcribe`);
    if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.onload = () => {
      let body: { text?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Respuesta no-JSON — se maneja abajo como error genérico.
      }
      if (xhr.status >= 200 && xhr.status < 300 && typeof body.text === "string") {
        resolve(body.text);
      } else {
        reject(new Error(body.error ?? "Error desconocido al transcribir"));
      }
    };
    xhr.onerror = () => reject(new Error("No se pudo contactar al servidor de transcripción."));
    xhr.send(formData);
  });
}
