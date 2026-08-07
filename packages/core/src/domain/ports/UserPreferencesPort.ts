import type { UserPreference } from "../entities/UserPreference";

/** CRUD completo de preferencias (mismo rol que MemoryStorePort para memoria) — usado por /configuracion. */
export interface UserPreferencesPort {
  list(userId: string): Promise<UserPreference[]>;
  get(userId: string, key: string): Promise<UserPreference | undefined>;
  set(userId: string, key: string, value: unknown): Promise<UserPreference>;
  remove(userId: string, key: string): Promise<void>;
}
