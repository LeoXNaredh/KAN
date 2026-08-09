import Link from "next/link";
import { SearchX } from "lucide-react";
import { PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

export default function ShellNotFound() {
  return (
    <div className="fade-in flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface-2/60 px-6 py-20 text-center">
      <SearchX className="h-6 w-6 text-ink-faint" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-ink">Página no encontrada</h1>
      <p className="max-w-md text-sm text-ink-muted">Esta sección no existe o se movió.</p>
      <Link href="/" className={PRIMARY_BUTTON_CLASSES}>
        Volver al Dashboard
      </Link>
    </div>
  );
}
