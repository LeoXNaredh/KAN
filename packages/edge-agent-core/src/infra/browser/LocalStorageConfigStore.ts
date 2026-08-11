import type { ConfigStorePort } from "../../domain/ports/ConfigStorePort";

/**
 * Equivalente de `JsonFileConfigStore` para el navegador (el Simulador
 * corriendo en `apps/web`, ver `@kan/edge-agent-core/browser`) — mismo
 * shape, un único blob JSON, pero persistido en `localStorage` en vez de
 * disco. No es un secreto lo que guarda (hoy: `edgeAgentId`, un UUID), así
 * que las garantías más débiles de `localStorage` frente a un archivo de
 * `userData` son aceptables acá.
 */
export class LocalStorageConfigStore implements ConfigStorePort {
  private data: Record<string, unknown>;

  constructor(private readonly storageKey: string) {
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
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private persist(): void {
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(this.data));
    } catch {
      // localStorage lleno o deshabilitado (modo privado): no debe tumbar al Edge Agent.
    }
  }
}
