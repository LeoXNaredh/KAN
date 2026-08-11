"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

export default function ShellError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ShellError]", error);
  }, [error]);

  return (
    <div className="glass fade-in flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-line/80 px-6 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10" style={{ boxShadow: "0 0 20px -6px var(--color-danger)" }}>
        <AlertTriangle className="h-6 w-6 text-danger" aria-hidden="true" />
      </div>
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
