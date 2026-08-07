import "../global.css";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SessionProvider, useSession } from "../lib/auth/SessionProvider";
import { useSupabaseAutoRefresh } from "../lib/supabase/useSupabaseAutoRefresh";

/**
 * Root layout (docs/18, incremento 2 — retrofit de expo-router sobre el
 * scaffold inicial). El CSS global solo se importa acá, nunca en un layout
 * anidado (requisito de Expo Router para que Metro arme bien el grafo).
 */
export default function RootLayout() {
  useSupabaseAutoRefresh();

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <RootNavigator />
        <StatusBar style="light" />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * `Stack.Protected` (patrón actual de expo-router, docs/18): las dos ramas
 * de rutas están siempre definidas — el `guard` decide cuál es alcanzable
 * según la sesión, no se monta/desmonta un árbol de navegación entero como
 * en el patrón clásico de React Navigation.
 */
function RootNavigator() {
  const { session, isLoading } = useSession();

  if (isLoading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
