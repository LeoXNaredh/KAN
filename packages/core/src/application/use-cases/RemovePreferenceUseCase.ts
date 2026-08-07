import type { UserPreferencesPort } from "../../domain/ports/UserPreferencesPort";

export class RemovePreferenceUseCase {
  constructor(private readonly preferencesStore: UserPreferencesPort) {}

  execute(userId: string, key: string): Promise<void> {
    return this.preferencesStore.remove(userId, key);
  }
}
