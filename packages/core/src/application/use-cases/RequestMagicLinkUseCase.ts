import type { AuthPort } from "../../domain/ports/AuthPort";

export class RequestMagicLinkUseCase {
  constructor(private readonly authPort: AuthPort) {}

  execute(email: string, redirectTo?: string): Promise<void> {
    return this.authPort.sendMagicLink(email, redirectTo);
  }
}
