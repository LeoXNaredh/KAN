import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { SupabasePushTokenStore } from "@kan/supabase-adapter";
import { supabase } from "../supabase/client";

/**
 * Registra el token de push Expo del usuario logueado (P7, ADR-040) —
 * mismo `supabase` de sesión que ya usa `lib/auth/composition.ts`, así que
 * el `insert`/`upsert` pasa por RLS con el usuario real, sin service_role.
 *
 * Nunca revienta el resto de la app: sin permiso, sin `projectId` de EAS
 * (falta `eas init`, ver docs/18), o cualquier otro error, solo loguea y
 * vuelve — la app sigue funcionando igual, simplemente sin push.
 */
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === "web") return; // fuera de alcance de este incremento (ver plan P7)

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      finalStatus = (await Notifications.requestPermissionsAsync()).status;
    }
    if (finalStatus !== "granted") {
      console.warn("[registerPushToken] permiso de notificaciones denegado, no se registra el token.");
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.warn(
        "[registerPushToken] falta expo.extra.eas.projectId (correr `eas init`) — no se puede registrar el token.",
      );
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const platform: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";

    await new SupabasePushTokenStore(supabase).register(userId, token, platform);
  } catch (error) {
    console.warn("[registerPushToken] no se pudo registrar el token de push:", error);
  }
}
