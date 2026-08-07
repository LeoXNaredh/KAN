// Relocalizado a @kan/plugin-contract (docs/16 P8, ADR-028) — compartido con
// @kan/gateway-core. Re-exportado acá para no tocar los ~10 archivos de este
// paquete que ya importan desde "./domain/ports/LoggerPort" o "../domain/ports/LoggerPort".
export type { LoggerPort, LogLevel } from "@kan/plugin-contract";
