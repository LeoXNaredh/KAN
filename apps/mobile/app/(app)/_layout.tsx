import { Tabs } from "expo-router";

/**
 * Navegación del área autenticada (docs/18, incremento 6) — mismas 3
 * secciones que la barra de `apps/web`'s shell (Chat, Dashboard,
 * Automatización), como pestañas nativas en vez de un nav lateral.
 */
export default function AppLayout() {
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
      <Tabs.Screen name="automatizaciones" options={{ title: "Automatización" }} />
    </Tabs>
  );
}
