import type { AuthPort } from "../../domain/ports/AuthPort";
import type { UserIdentity } from "../../domain/entities/UserIdentity";

export class GetCurrentUserUseCase {
  constructor(private readonly authPort: AuthPort) {}

  execute(): Promise<UserIdentity | undefined> {
    return this.authPort.getCurrentUser();
  }
}
