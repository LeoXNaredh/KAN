"use client";

import { AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import type { PendingConfirmation } from "@/lib/chat/useConversation";

const SEVERITY_LABEL: Record<string, string> = {
  "irreversible-material": "Irreversible / material",
  "safety-critical": "Crítica para la seguridad",
};

/**
 * Modal de confirmación de acción física para el chat web (ADR-059) —
 * equivalente al `ConfirmationModal` que ya existía únicamente en
 * `apps/desktop`. Hasta este incremento, una acción `irreversible-material`/
 * `safety-critical` pedida desde el chat web fallaba de inmediato con un
 * mensaje pidiendo confirmarla en la app de escritorio; ahora se puede
 * confirmar o cancelar acá mismo.
 */
export function PendingConfirmationModal({
  confirmation,
  onCancel,
  onConfirm,
  busy,
}: {
  confirmation: PendingConfirmation;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const severityLabel = SEVERITY_LABEL[confirmation.severity] ?? confirmation.severity;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card padding="lg" className="w-full max-w-sm">
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-ink">Confirmar acción física</h3>
        </div>
        <p className="mb-3 text-sm text-ink-muted">
          Esta acción es <span className="font-medium text-warning">{severityLabel}</span> y no se ejecuta sin tu
          confirmación explícita.
        </p>
        <div className="mb-4 rounded-md border border-line bg-surface-3 px-3 py-2 font-mono text-xs text-ink-muted">
          {confirmation.capabilityName} en {confirmation.deviceId}
          <br />
          entrada: {JSON.stringify(confirmation.input)}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="press rounded-md px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="press rounded-md bg-warning px-3 py-1.5 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Confirmar y ejecutar
          </button>
        </div>
      </Card>
    </div>
  );
}
