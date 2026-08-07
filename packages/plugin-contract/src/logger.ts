/**
 * Contrato de logging compartido (docs/16 P8, ADR-028) — vive acá porque
 * tanto `@kan/edge-agent-core` como `@kan/gateway-core` lo necesitan y
 * ninguno de los dos es dueño natural del otro. Cada lado sigue eligiendo
 * su propio adaptador (`FileAndConsoleLogger` en el Edge Agent, con archivo
 * local y bus para la UI de apps/desktop; `ConsoleLogger` en el Gateway,
 * sin ninguno de los dos).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerPort {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
