import Link from "next/link";
import { SearchX } from "lucide-react";
import { PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

export default function ShellNotFound() {
  return (
    <div className="glass fade-in flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-line/80 px-6 py-20 text-center">
      <div className="bg-gradient-accent-soft flex h-12 w-12 items-center justify-center rounded-2xl">
        <SearchX className="h-6 w-6 text-ink-faint" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-semibold text-ink">Página no encontrada</h1>
      <p className="max-w-md text-sm text-ink-muted">Esta sección no existe o se movió.</p>
      <Link href="/" className={PRIMARY_BUTTON_CLASSES}>
        Volver al Dashboard
      </Link>
    </div>
  );
}
