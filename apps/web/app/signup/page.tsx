import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASSES, PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { signUpAction } from "./actions";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Card className="w-full max-w-sm fade-in">
        <h1 className="mb-1 text-lg font-semibold text-ink">Crear cuenta</h1>
        <p className="mb-6 text-sm text-ink-faint">Empieza a usar KAN.</p>

        {params.error && (
          <p className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {params.error}
          </p>
        )}

        <form action={signUpAction} className="flex flex-col gap-3">
          <input name="email" type="email" required placeholder="Email" autoComplete="email" className={INPUT_CLASSES} />
          <input
            name="password"
            type="password"
            required
            minLength={6}
            placeholder="Contraseña (mínimo 6 caracteres)"
            autoComplete="new-password"
            className={INPUT_CLASSES}
          />
          <button type="submit" className={PRIMARY_BUTTON_CLASSES}>
            Crear cuenta
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-faint">
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Inicia sesión
          </Link>
        </p>
      </Card>
    </div>
  );
}
