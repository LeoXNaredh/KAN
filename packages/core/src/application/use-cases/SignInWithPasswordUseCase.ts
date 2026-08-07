import type { AuthPort, PasswordCredentials } from "../../domain/ports/AuthPort";
import type { UserIdentity } from "../../domain/entities/UserIdentity";

export class SignInWithPasswordUseCase {
  constructor(private readonly authPort: AuthPort) {}

  execute(credentials: PasswordCredentials): Promise<UserIdentity> {
    return this.authPort.signInWithPassword(credentials);
  }
}
