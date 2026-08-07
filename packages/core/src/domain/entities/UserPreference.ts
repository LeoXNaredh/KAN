/** Preferencia key/value por usuario (P0.1: tabla user_preferences, sin uso hasta ahora). */
export interface UserPreference {
  userId: string;
  key: string;
  value: unknown;
  updatedAt: string;
}
