import { useState } from "react";
import { Link, useRouter } from "expo-router";
import { Pressable, Text, TextInput, View } from "react-native";
import { useSession } from "../../lib/auth/SessionProvider";

const MIN_PASSWORD_LENGTH = 6; // mismo límite que apps/web/app/signup/page.tsx

export default function RegisterScreen() {
  const { useCases } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRegister() {
    setError(undefined);
    setIsSubmitting(true);
    try {
      await useCases.registerUser.execute({ email, password });
      // Mismo patrón que apps/web/app/signup/actions.ts: no inicia sesión
      // automático, redirige a login con un mensaje de éxito.
      router.replace({ pathname: "/(auth)/login", params: { registered: "1" } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View className="flex-1 justify-center gap-4 bg-surface px-6">
      <Text className="text-lg font-semibold text-ink">Crear cuenta</Text>

      {error && (
        <Text className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</Text>
      )}

      <TextInput
        className="rounded-lg border border-line bg-surface-3 px-3 py-2 text-ink"
        placeholder="Email"
        placeholderTextColor="#5b6472"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        className="rounded-lg border border-line bg-surface-3 px-3 py-2 text-ink"
        placeholder={`Contraseña (mínimo ${MIN_PASSWORD_LENGTH} caracteres)`}
        placeholderTextColor="#5b6472"
        secureTextEntry
        autoComplete="new-password"
        value={password}
        onChangeText={setPassword}
      />

      <Pressable
        className="items-center rounded-lg bg-accent px-4 py-3 active:opacity-80 disabled:opacity-50"
        disabled={isSubmitting || !email || password.length < MIN_PASSWORD_LENGTH}
        onPress={handleRegister}
      >
        <Text className="text-sm font-medium text-white">Crear cuenta</Text>
      </Pressable>

      <Link href="/(auth)/login" className="text-center text-sm text-ink-muted">
        ¿Ya tenés cuenta? Iniciá sesión
      </Link>
    </View>
  );
}
