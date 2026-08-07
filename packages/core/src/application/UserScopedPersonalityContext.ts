import type { UserPreferencesPort } from "../domain/ports/UserPreferencesPort";
import type { PersonalityContextPort } from "../domain/ports/PersonalityContextPort";

const PERSONALITY_KEY = "personality";

/**
 * Envuelve cualquier UserPreferencesPort + un userId fijo para exponer
 * PersonalityContextPort — mismo rol que UserScopedMemoryContext para
 * memoria, vive en core a propósito (no específico de ningún proveedor).
 */
export class UserScopedPersonalityContext implements PersonalityContextPort {
  constructor(
    private readonly store: UserPreferencesPort,
    private readonly userId: string,
  ) {}

  async getPersonality(): Promise<string | undefined> {
    const pref = await this.store.get(this.userId, PERSONALITY_KEY);
    return typeof pref?.value === "string" ? pref.value : undefined;
  }
}
