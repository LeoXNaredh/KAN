import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { INPUT_CLASSES, PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { signInWithPasswordAction, sendMagicLinkAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; magicLinkSent?: string; registered?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Card className="w-full max-w-sm fade-in">
        <h1 className="mb-1 text-lg font-semibold text-ink">Iniciar sesión</h1>
        <p className="mb-6 text-sm text-ink-faint">Bienvenido de nuevo a KAN.</p>

        {params.registered && (
          <p className="mb-4 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
            Cuenta creada. Revisa tu email para confirmar (si tu proyecto lo requiere) e inicia sesión.
          </p>
        )}
        {params.magicLinkSent && (
          <p className="mb-4 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
            Te enviamos un Magic Link — revisa tu correo.
          </p>
        )}
        {params.error && (
          <p className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {params.error}
          </p>
        )}

        <form action={signInWithPasswordAction} className="flex flex-col gap-3">
          <input name="email" type="email" required placeholder="Email" autoComplete="email" className={INPUT_CLASSES} />
          <input
            name="password"
            type="password"
            required
            placeholder="Contraseña"
            autoComplete="current-password"
            className={INPUT_CLASSES}
          />
          <button type="submit" className={PRIMARY_BUTTON_CLASSES}>
            Entrar
          </button>
        </form>

        <form action={sendMagicLinkAction} className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-xs text-ink-faint">O entra sin contraseña:</p>
          <input name="email" type="email" required placeholder="Email para Magic Link" className={INPUT_CLASSES} />
          <button type="submit" className={SECONDARY_BUTTON_CLASSES}>
            Enviarme un Magic Link
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-faint">
          ¿No tienes cuenta?{" "}
          <Link href="/signup" className="text-accent hover:underline">
            Regístrate
          </Link>
        </p>
      </Card>
    </div>
  );
}
