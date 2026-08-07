import { Pressable, Text, View } from "react-native";
import { useSession } from "../../lib/auth/SessionProvider";

/**
 * Placeholder del área autenticada (docs/18, incremento 2) — solo demuestra
 * que Stack.Protected funciona. El chat real es el incremento 3.
 */
export default function HomeScreen() {
  const { session, useCases } = useSession();

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-surface px-6">
      <Text className="text-lg font-semibold text-ink">Sesión iniciada</Text>
      <Text className="text-sm text-ink-faint">{session?.email}</Text>
      <Pressable
        className="rounded-lg border border-line px-4 py-2 active:opacity-80"
        onPress={() => useCases.signOut.execute()}
      >
        <Text className="text-sm text-ink">Cerrar sesión</Text>
      </Pressable>
    </View>
  );
}
