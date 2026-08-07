import { useEffect } from "react";
import { AppState } from "react-native";
import { supabase } from "./client";

/**
 * Patrón recomendado por Supabase para RN (docs/18 §2): el refresh
 * automático del token solo debe correr mientras la app está en primer
 * plano — evita refrescos innecesarios (o fallidos, sin red) en background.
 */
export function useSupabaseAutoRefresh(): void {
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    });

    return () => subscription.remove();
  }, []);
}
