import type { AuthPort } from "../../domain/ports/AuthPort";

export class RequestOAuthSignInUseCase {
  constructor(private readonly authPort: AuthPort) {}

  execute(provider: "google", redirectTo: string): Promise<string> {
    return this.authPort.getOAuthRedirectUrl(provider, redirectTo);
  }
}
