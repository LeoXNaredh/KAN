import {
  ACTOR_LABEL,
  deviceFromAuditEntry,
  resultFromAuditEntry,
  translateAuditEntry,
  type RawAuditEntry,
} from "@/lib/status/translateAuditEntry";

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * CSV del historial de /logs, generado 100% en el cliente con los mismos
 * `entries` que ya recibió la pantalla (sin fetch nuevo). BOM al inicio para
 * que Excel en Windows abra los acentos bien; `\r\n` entre filas (RFC 4180).
 */
export function buildAuditLogCsv(entries: RawAuditEntry[]): string {
  const header = ["Fecha y hora", "Quién", "Qué hizo", "Dispositivo", "Resultado"];
  const rows = entries
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((entry) => [
      new Date(entry.at).toLocaleString(),
      ACTOR_LABEL[entry.actor] ?? entry.actor,
      translateAuditEntry(entry),
      deviceFromAuditEntry(entry),
      resultFromAuditEntry(entry),
    ]);

  const lines = [header, ...rows].map((row) => row.map(csvField).join(","));
  return `﻿${lines.join("\r\n")}`;
}
