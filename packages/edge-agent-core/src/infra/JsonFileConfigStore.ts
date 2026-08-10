import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";

/** Coalesce varios set() seguidos (ej. sincronizar varias claves de golpe) en una sola escritura real. */
const WRITE_DEBOUNCE_MS = 50;

/**
 * Configuración local persistida en disco (requisito 12). El path lo decide
 * quien compone el Edge Agent (en apps/desktop, `app.getPath('userData')`),
 * así que este adaptador no conoce nada de Electron.
 *
 * Escritura incremental (fix de auditoría de backend): antes, cada `set()`
 * disparaba un `writeFileSync` bloqueante del archivo completo, aunque solo
 * hubiera cambiado una clave — con el store creciendo (plugins instalados,
 * Safety Policy por dispositivo, config sincronizada) eso bloqueaba el
 * proceso main de Electron una vez por cada cambio. Ahora `set()` actualiza
 * `this.data` al toque (get() nunca ve datos viejos) pero la escritura a
 * disco se coalesce con un debounce corto y corre async (`fs/promises`), sin
 * bloquear el event loop.
 */
export class JsonFileConfigStore implements ConfigStorePort {
  private data: Record<string, unknown>;
  private writeTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingWrite: Promise<void> | undefined;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  get<T>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.data[key] = value;
    this.schedulePersist();
  }

  all(): Record<string, unknown> {
    return { ...this.data };
  }

  /**
   * Espera a que cualquier escritura pendiente (debounced o ya en vuelo)
   * termine de llegar a disco — necesario antes de `app.exit()`/`app.quit()`
   * en Electron, que no garantizan que el event loop drene los timers/I-O
   * pendientes antes de terminar el proceso (a diferencia de una salida
   * normal). Sin esto, un `set()` seguido de `app.exit()` podría perder el
   * cambio (ej. el `pairingToken` recién recibido en `pairAgent()`).
   */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
      this.pendingWrite = (this.pendingWrite ?? Promise.resolve()).then(() => this.persistNow());
    }
    await this.pendingWrite;
  }

  private load(): Record<string, unknown> {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  private schedulePersist(): void {
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      // Encadenado sobre la escritura anterior (si todavía está en vuelo)
      // para que nunca corran dos a la vez — cada una lee `this.data` recién
      // al ejecutarse, así que la última en la cadena siempre gana con el
      // estado más fresco, sin importar cuánto tarde el disco.
      this.pendingWrite = (this.pendingWrite ?? Promise.resolve()).then(() => this.persistNow());
    }, WRITE_DEBOUNCE_MS);
    this.writeTimer.unref?.();
  }

  private async persistNow(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }
}
