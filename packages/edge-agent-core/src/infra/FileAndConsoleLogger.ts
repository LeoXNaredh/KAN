import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LoggerPort, LogLevel } from "../domain/ports/LoggerPort";
import type { EdgeAgentBus } from "../application/EdgeAgentBus";

/**
 * Logging estructurado (requisito 11): consola + archivo local, y además
 * emite cada entrada al bus interno para que la UI del Edge Agent muestre
 * logs en vivo sin tener que leer el archivo.
 */
export class FileAndConsoleLogger implements LoggerPort {
  constructor(
    private readonly filePath: string,
    private readonly bus: EdgeAgentBus,
  ) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

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
    const line = `[${at}] [${level.toUpperCase()}] ${message}${meta ? " " + JSON.stringify(meta) : ""}`;

    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](line);

    try {
      appendFileSync(this.filePath, line + "\n", "utf-8");
    } catch {
      // Si el archivo de log falla, no debe tumbar al Edge Agent.
    }

    this.bus.emit("log", { level, message, meta, at });
  }
}
