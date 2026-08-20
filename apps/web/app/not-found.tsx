import Link from "next/link";
import { SearchX } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

export default function RootNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Card className="fade-in flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <SearchX className="h-6 w-6 text-ink-faint" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-ink">Página no encontrada</h1>
        <p className="text-sm text-ink-muted">Esta sección no existe o se movió.</p>
        <Link href="/inicio" className={PRIMARY_BUTTON_CLASSES}>
          Volver al Dashboard
        </Link>
      </Card>
    </div>
  );
}
