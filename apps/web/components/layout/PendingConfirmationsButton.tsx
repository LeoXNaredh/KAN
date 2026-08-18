"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { usePendingConfirmations } from "@/lib/confirmations/usePendingConfirmations";
import { PendingConfirmationModal } from "@/components/dashboard/PendingConfirmationModal";
import type { PendingConfirmation } from "@/lib/chat/useConversation";

/**
 * Bandeja de confirmaciones pendientes (requisito: verlas/aprobarlas fuera
 * del chat que las disparó — ej. una secuencia de una alerta sin
 * conversación activa) — badge en el TopBar, visible en cualquier página, no
 * solo en el chat. Al hacer clic reusa el mismo `PendingConfirmationModal`
 * que ya usa `ConversationPanel`/`KANHome`, apuntando al mismo
 * `POST /v1/confirmations/:id/resolve` (vía `usePendingConfirmations()`),
 * sin ningún camino nuevo. Nada que mostrar (`confirmations.length === 0`):
 * no renderiza nada, ni el botón ni el modal.
 *
 * "En orden": siempre opera sobre `confirmations[0]` — al resolverla, la
 * lista se achica sola (`usePendingConfirmations` la saca en cuanto
 * responde el POST) y la que sigue pasa a ocupar ese lugar automáticamente,
 * sin ningún índice ni estado de "cuál estoy mirando" que mantener acá. Si
 * la lista queda vacía, el componente entero deja de renderizarse — el
 * modal se cierra solo, sin un botón de "cerrar sin decidir" (mismo
 * criterio que el modal ya tiene en el chat: se aprueba o se cancela, no se
 * descarta en silencio una acción física pendiente).
 */
export function PendingConfirmationsButton() {
  const { confirmations, resolving, resolve } = usePendingConfirmations();
  const [open, setOpen] = useState(false);

  if (confirmations.length === 0) return null;

  const current = confirmations[0];
  const modalConfirmation: PendingConfirmation = {
    type: "pending_confirmation",
    confirmationId: current.confirmationId,
    deviceId: current.deviceId,
    capabilityName: current.capabilityName,
    input: current.input,
    severity: current.severity,
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${confirmations.length} ${confirmations.length === 1 ? "confirmación pendiente" : "confirmaciones pendientes"}`}
        title={confirmations.length === 1 ? "1 confirmación pendiente" : `${confirmations.length} confirmaciones pendientes`}
        className="press relative rounded-full p-2 text-warning transition-colors hover:bg-warning/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 text-[10px] font-semibold text-black">
          {confirmations.length}
        </span>
      </button>

      {open && (
        <PendingConfirmationModal
          confirmation={modalConfirmation}
          busy={resolving}
          onCancel={() => void resolve(current.confirmationId, false)}
          onConfirm={() => void resolve(current.confirmationId, true)}
        />
      )}
    </>
  );
}
