import type { AuthPort } from "../../domain/ports/AuthPort";

export class SignOutUseCase {
  constructor(private readonly authPort: AuthPort) {}

  execute(): Promise<void> {
    return this.authPort.signOut();
  }
}
