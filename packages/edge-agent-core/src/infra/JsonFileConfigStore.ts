import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConfigStorePort } from "../domain/ports/ConfigStorePort";

/**
 * Configuración local persistida en disco (requisito 12). El path lo decide
 * quien compone el Edge Agent (en apps/desktop, `app.getPath('userData')`),
 * así que este adaptador no conoce nada de Electron.
 */
export class JsonFileConfigStore implements ConfigStorePort {
  private data: Record<string, unknown>;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  get<T>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.data[key] = value;
    this.persist();
  }

  all(): Record<string, unknown> {
    return { ...this.data };
  }

  private load(): Record<string, unknown> {
    if (!existsSync(this.filePath)) return {};
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }
}
