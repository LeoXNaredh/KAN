export interface ConfigStorePort {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  all(): Record<string, unknown>;
}
