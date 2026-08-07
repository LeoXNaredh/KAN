import type { LoggerPort, LogLevel } from "@kan/plugin-contract";

/**
 * Adaptador simple para el Gateway (docs/16 P8, ADR-028) — a diferencia de
 * `FileAndConsoleLogger` (@kan/edge-agent-core), no escribe a archivo local
 * ni emite a ningún bus: el Gateway ya persiste su propio audit trail
 * aparte (`AuditService`/`SupabaseAuditStore`, ADR-026), un archivo de log
 * adicional sería redundante para lo que este incremento resuelve.
 */
export class ConsoleLogger implements LoggerPort {
  debug(message: string, meta?: Record<string, unknown>): void {
    this.write("debug", message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write("error", message, meta);
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    const method = level === "debug" ? "log" : level;
    if (meta) console[method](line, meta);
    else console[method](line);
  }
}
