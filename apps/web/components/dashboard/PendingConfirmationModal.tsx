"use client";

import { AlertTriangle } from "lucide-react";
import { describeConfirmationConsequence } from "@kan/plugin-contract";
import { Card } from "@/components/ui/Card";
import type { PendingConfirmation } from "@/lib/chat/useConversation";

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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card padding="lg" className="w-full max-w-sm">
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-ink">¿Confirmás esta acción?</h3>
        </div>
        <p className="mb-4 text-sm text-ink-muted">{describeConfirmationConsequence(confirmation.severity)}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="press rounded-md px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            No, cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="press rounded-md bg-warning px-3 py-1.5 text-sm font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Sí, hacelo
          </button>
        </div>
      </Card>
    </div>
  );
}
