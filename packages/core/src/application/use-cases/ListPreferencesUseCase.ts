import type { UserPreferencesPort } from "../../domain/ports/UserPreferencesPort";
import type { UserPreference } from "../../domain/entities/UserPreference";

export class ListPreferencesUseCase {
  constructor(private readonly preferencesStore: UserPreferencesPort) {}

  execute(userId: string): Promise<UserPreference[]> {
    return this.preferencesStore.list(userId);
  }
}
