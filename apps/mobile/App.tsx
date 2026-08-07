import "./global.css";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useSupabaseAutoRefresh } from "./lib/supabase/useSupabaseAutoRefresh";

/**
 * Scaffold inicial (docs/18) — todavía sin auth ni chat conectados, solo
 * confirma que NativeWind renderiza los tokens de DESIGN_SYSTEM.md
 * (ADR-031) sobre componentes nativos reales.
 */
export default function App() {
  useSupabaseAutoRefresh();

  return (
    <SafeAreaProvider>
      <SafeAreaView className="flex-1 bg-surface">
        <View className="flex-1 items-center justify-center gap-2 px-6">
          <Text className="text-lg font-semibold text-ink">KAN</Text>
          <Text className="text-sm text-ink-faint">Scaffold móvil — docs/18</Text>
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
