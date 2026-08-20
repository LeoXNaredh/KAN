"use client";

import { Download } from "lucide-react";
import { SECONDARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { buildAuditLogCsv } from "@/lib/logs/buildAuditLogCsv";
import type { RawAuditEntry } from "@/lib/status/translateAuditEntry";

/**
 * Descarga el historial ya cargado en /logs como CSV, directo desde el
 * navegador (Blob + <a download>) — sin pasar por el servidor, mismo dato
 * que ya está en pantalla.
 */
export function ExportLogsButton({ entries }: { entries: RawAuditEntry[] }) {
  function handleExport() {
    const csv = buildAuditLogCsv(entries);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kan-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={handleExport}
      className={`press flex shrink-0 items-center gap-1.5 ${SECONDARY_BUTTON_CLASSES}`}
    >
      <Download className="h-3.5 w-3.5" aria-hidden="true" />
      Exportar
    </button>
  );
}
