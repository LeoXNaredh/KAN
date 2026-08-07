import type { UserPreferencesPort } from "../../domain/ports/UserPreferencesPort";
import type { UserPreference } from "../../domain/entities/UserPreference";

export class SetPreferenceUseCase {
  constructor(private readonly preferencesStore: UserPreferencesPort) {}

  execute(userId: string, key: string, value: unknown): Promise<UserPreference> {
    return this.preferencesStore.set(userId, key, value);
  }
}
