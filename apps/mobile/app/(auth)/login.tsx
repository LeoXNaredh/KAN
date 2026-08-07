import { useState } from "react";
import { Link, useLocalSearchParams } from "expo-router";
import { Pressable, Text, TextInput, View } from "react-native";
import { useSession } from "../../lib/auth/SessionProvider";

/**
 * Mismos campos y mismo criterio de errores que apps/web/app/login/page.tsx
 * (docs/18, incremento 2): el mensaje de la excepción se muestra tal cual,
 * sin sanitizar. Magic Link queda fuera de este incremento (ver docs/18).
 */
export default function LoginScreen() {
  const { useCases } = useSession();
  const { registered } = useLocalSearchParams<{ registered?: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignIn() {
    setError(undefined);
    setIsSubmitting(true);
    try {
      await useCases.signInWithPassword.execute({ email, password });
      // La sesión se actualiza sola vía onAuthStateChange (SessionProvider)
      // — Stack.Protected en app/_layout.tsx redirige automáticamente.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View className="flex-1 justify-center gap-4 bg-surface px-6">
      <Text className="text-lg font-semibold text-ink">Iniciar sesión</Text>

      {registered === "1" && (
        <Text className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
          Cuenta creada. Ahora inicia sesión.
        </Text>
      )}
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
        placeholder="Contraseña"
        placeholderTextColor="#5b6472"
        secureTextEntry
        autoComplete="current-password"
        value={password}
        onChangeText={setPassword}
      />

      <Pressable
        className="items-center rounded-lg bg-accent px-4 py-3 active:opacity-80 disabled:opacity-50"
        disabled={isSubmitting || !email || !password}
        onPress={handleSignIn}
      >
        <Text className="text-sm font-medium text-white">Entrar</Text>
      </Pressable>

      <Link href="/(auth)/register" className="text-center text-sm text-ink-muted">
        ¿No tenés cuenta? Creá una
      </Link>
    </View>
  );
}
