import type { LoggerPort, LogLevel } from "../../domain/ports/LoggerPort";
import type { EdgeAgentBus } from "../../application/EdgeAgentBus";

/**
 * Equivalente de `FileAndConsoleLogger` para el navegador — sin la parte de
 * archivo (no hay filesystem en un tab). Sigue emitiendo al bus para que la
 * UI pueda mostrar logs en vivo si algún día hace falta.
 */
export class ConsoleLogger implements LoggerPort {
  constructor(private readonly bus: EdgeAgentBus) {}

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
    const at = new Date().toISOString();
    const line = `[${at}] [${level.toUpperCase()}] ${message}`;

    console[level === "debug" ? "log" : level](line, meta ?? "");
    this.bus.emit("log", { level, message, meta, at });
  }
}
