import type { UserPreference } from "../entities/UserPreference";

/** CRUD completo de preferencias (mismo rol que MemoryStorePort para memoria) — usado por /configuracion. */
export interface UserPreferencesPort {
  list(userId: string): Promise<UserPreference[]>;
  get(userId: string, key: string): Promise<UserPreference | undefined>;
  set(userId: string, key: string, value: unknown): Promise<UserPreference>;
  remove(userId: string, key: string): Promise<void>;
  /**
   * Cruza usuarios (a diferencia de `list`, scopeado a uno) — pensado para
   * el Gateway (DailyReportService, `service_role`) recorriendo "todos los
   * usuarios con `dailyReportEnabled`". Llamado desde `apps/web` (sesión
   * ANON) queda igual de acotado por RLS a las propias filas del usuario.
   */
  listAllForKey(key: string): Promise<UserPreference[]>;
}
