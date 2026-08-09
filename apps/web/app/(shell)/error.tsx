"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ShellError]", error);
  }, [error]);

  return (
    <div className="fade-in flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-line bg-surface-2/60 px-6 py-20 text-center">
      <AlertTriangle className="h-6 w-6 text-danger" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-ink">Algo salió mal</h1>
      <p className="max-w-md text-sm text-ink-muted">
        No se pudo cargar esta página. Podés intentar de nuevo — si el problema sigue, probá recargar KAN.
      </p>
      <button type="button" onClick={reset} className={PRIMARY_BUTTON_CLASSES}>
        Reintentar
      </button>
    </div>
  );
}
