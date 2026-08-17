import { describe, expect, it } from "vitest";
import { SignInWithPasswordUseCase } from "./SignInWithPasswordUseCase";
import type { AuthPort, PasswordCredentials } from "../../domain/ports/AuthPort";
import type { UserIdentity } from "../../domain/entities/UserIdentity";

class RecordingAuthPort implements AuthPort {
  calls: PasswordCredentials[] = [];
  constructor(
    private readonly result: UserIdentity | (() => Promise<UserIdentity>) = { userId: "u1", email: "gio@example.com" },
  ) {}

  async signInWithPassword(credentials: PasswordCredentials): Promise<UserIdentity> {
    this.calls.push(credentials);
    return typeof this.result === "function" ? this.result() : this.result;
  }

  registerWithPassword(): Promise<UserIdentity> {
    throw new Error("no debería llamarse en este use case");
  }
  sendMagicLink(): Promise<void> {
    throw new Error("no debería llamarse en este use case");
  }
  getOAuthRedirectUrl(): Promise<string> {
    throw new Error("no debería llamarse en este use case");
  }
  signOut(): Promise<void> {
    throw new Error("no debería llamarse en este use case");
  }
  getCurrentUser(): Promise<UserIdentity | undefined> {
    throw new Error("no debería llamarse en este use case");
  }
}

describe("SignInWithPasswordUseCase (fix de auditoría de backend #5)", () => {
  it("pasa las credenciales tal cual al AuthPort", async () => {
    const port = new RecordingAuthPort();
    const useCase = new SignInWithPasswordUseCase(port);

    await useCase.execute({ email: "gio@example.com", password: "hunter2" });

    expect(port.calls).toEqual([{ email: "gio@example.com", password: "hunter2" }]);
  });

  it("devuelve la identidad tal cual la da el AuthPort", async () => {
    const identity: UserIdentity = { userId: "u42", email: "gio@example.com" };
    const port = new RecordingAuthPort(identity);
    const useCase = new SignInWithPasswordUseCase(port);

    await expect(useCase.execute({ email: "gio@example.com", password: "hunter2" })).resolves.toEqual(identity);
  });

  it("propaga el error del AuthPort sin envolverlo ni tragárselo (ej. credenciales inválidas)", async () => {
    const port = new RecordingAuthPort(() => Promise.reject(new Error("Invalid login credentials")));
    const useCase = new SignInWithPasswordUseCase(port);

    await expect(useCase.execute({ email: "gio@example.com", password: "mal" })).rejects.toThrow(
      "Invalid login credentials",
    );
  });
});
