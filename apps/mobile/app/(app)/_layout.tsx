import { useEffect } from "react";
import { Tabs } from "expo-router";
import { useSession } from "../../lib/auth/SessionProvider";
import { registerPushToken } from "../../lib/notifications/registerPushToken";

/**
 * Navegación del área autenticada (docs/18, incremento 6) — mismas 3
 * secciones que la barra de `apps/web`'s shell (Chat, Dashboard,
 * Automatización), como pestañas nativas en vez de un nav lateral.
 *
 * Este layout solo se monta con sesión activa (guard en app/_layout.tsx),
 * así que es el lugar natural para registrar el token de push una vez por
 * sesión (P7, ADR-040) — sin pantalla ni gesto de usuario dedicado.
 */
export default function AppLayout() {
  const { session } = useSession();

  useEffect(() => {
    if (session?.userId) registerPushToken(session.userId);
  }, [session?.userId]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#0ea5e9",
        tabBarInactiveTintColor: "#5b6472",
        tabBarStyle: { backgroundColor: "#0b0e14", borderTopColor: "#1f2430" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Chat" }} />
      <Tabs.Screen name="dashboard" options={{ title: "Dashboard" }} />
      <Tabs.Screen name="sensores" options={{ title: "Sensores" }} />
      <Tabs.Screen name="control" options={{ title: "Control" }} />
      <Tabs.Screen name="dispositivos" options={{ title: "Dispositivos" }} />
      <Tabs.Screen name="alertas" options={{ title: "Alertas" }} />
      <Tabs.Screen name="automatizaciones" options={{ title: "Automatización" }} />
    </Tabs>
  );
}
