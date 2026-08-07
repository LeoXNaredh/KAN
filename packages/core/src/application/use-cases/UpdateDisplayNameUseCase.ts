import type { UserProfilePort } from "../../domain/ports/UserProfilePort";
import type { UserProfile } from "../../domain/entities/UserProfile";

export class UpdateDisplayNameUseCase {
  constructor(private readonly userProfilePort: UserProfilePort) {}

  execute(userId: string, displayName: string): Promise<UserProfile> {
    return this.userProfilePort.updateDisplayName(userId, displayName);
  }
}
