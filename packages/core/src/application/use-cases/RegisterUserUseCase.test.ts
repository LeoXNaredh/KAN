import { describe, expect, it } from "vitest";
import { RegisterUserUseCase } from "./RegisterUserUseCase";
import type { AuthPort, PasswordCredentials } from "../../domain/ports/AuthPort";
import type { UserIdentity } from "../../domain/entities/UserIdentity";

class RecordingAuthPort implements AuthPort {
  calls: PasswordCredentials[] = [];
  constructor(
    private readonly result: UserIdentity | (() => Promise<UserIdentity>) = { userId: "u1", email: "gio@example.com" },
  ) {}

  async registerWithPassword(credentials: PasswordCredentials): Promise<UserIdentity> {
    this.calls.push(credentials);
    return typeof this.result === "function" ? this.result() : this.result;
  }

  signInWithPassword(): Promise<UserIdentity> {
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

describe("RegisterUserUseCase (fix de auditoría de backend #5)", () => {
  it("pasa las credenciales tal cual al AuthPort", async () => {
    const port = new RecordingAuthPort();
    const useCase = new RegisterUserUseCase(port);

    await useCase.execute({ email: "nuevo@example.com", password: "hunter2" });

    expect(port.calls).toEqual([{ email: "nuevo@example.com", password: "hunter2" }]);
  });

  it("devuelve la identidad tal cual la da el AuthPort", async () => {
    const identity: UserIdentity = { userId: "u42", email: "nuevo@example.com" };
    const port = new RecordingAuthPort(identity);
    const useCase = new RegisterUserUseCase(port);

    await expect(useCase.execute({ email: "nuevo@example.com", password: "hunter2" })).resolves.toEqual(identity);
  });

  it("propaga el error del AuthPort sin envolverlo ni tragárselo (ej. email ya registrado)", async () => {
    const port = new RecordingAuthPort(() => Promise.reject(new Error("User already registered")));
    const useCase = new RegisterUserUseCase(port);

    await expect(useCase.execute({ email: "existente@example.com", password: "hunter2" })).rejects.toThrow(
      "User already registered",
    );
  });
});
