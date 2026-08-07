import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente de Supabase para React Native (ADR-017/docs/18 §2) — sin
 * `@supabase/ssr` (específico de Next.js/cookies): la sesión persiste en
 * AsyncStorage, no en un cookie jar. Reutiliza sin cambios los adaptadores
 * de `@kan/supabase-adapter` (`SupabaseAuthAdapter`, etc.) inyectando este
 * cliente en vez del cliente cookie-bound que arma `apps/web`.
 *
 * `AsyncStorage` en vez de `expo-sqlite/localStorage`: la investigación de
 * docs/18 encontró dos guías vigentes en paralelo en la documentación de
 * Supabase/Expo — se eligió AsyncStorage por ser el patrón más establecido
 * y documentado; revisitar si Supabase consolida `expo-sqlite` como único
 * recomendado.
 */
function requireEnv(name: "EXPO_PUBLIC_SUPABASE_URL" | "EXPO_PUBLIC_SUPABASE_ANON_KEY"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name}. Copiá apps/mobile/.env.example a apps/mobile/.env y agregá tus credenciales.`);
  }
  return value;
}

export const supabase = createClient(
  requireEnv("EXPO_PUBLIC_SUPABASE_URL"),
  requireEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY"),
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
