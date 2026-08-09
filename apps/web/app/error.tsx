"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { PRIMARY_BUTTON_CLASSES } from "@/components/ui/formStyles";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[RootError]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Card className="fade-in flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <AlertTriangle className="h-6 w-6 text-danger" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-ink">Algo salió mal</h1>
        <p className="text-sm text-ink-muted">
          No se pudo cargar esta página. Podés intentar de nuevo — si el problema sigue, probá recargar KAN.
        </p>
        <button type="button" onClick={reset} className={PRIMARY_BUTTON_CLASSES}>
          Reintentar
        </button>
      </Card>
    </div>
  );
}
