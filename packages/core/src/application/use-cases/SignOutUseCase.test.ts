import { describe, expect, it } from "vitest";
import { SignOutUseCase } from "./SignOutUseCase";
import type { AuthPort } from "../../domain/ports/AuthPort";
import type { UserIdentity } from "../../domain/entities/UserIdentity";

class RecordingAuthPort implements AuthPort {
  signOutCalls = 0;
  constructor(private readonly onSignOut: () => Promise<void> = () => Promise.resolve()) {}

  async signOut(): Promise<void> {
    this.signOutCalls += 1;
    return this.onSignOut();
  }

  registerWithPassword(): Promise<UserIdentity> {
    throw new Error("no debería llamarse en este use case");
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
  getCurrentUser(): Promise<UserIdentity | undefined> {
    throw new Error("no debería llamarse en este use case");
  }
}

describe("SignOutUseCase (fix de auditoría de backend #5)", () => {
  it("delega en AuthPort.signOut()", async () => {
    const port = new RecordingAuthPort();
    const useCase = new SignOutUseCase(port);

    await useCase.execute();

    expect(port.signOutCalls).toBe(1);
  });

  it("resuelve sin valor cuando el AuthPort resuelve bien", async () => {
    const port = new RecordingAuthPort();
    const useCase = new SignOutUseCase(port);

    await expect(useCase.execute()).resolves.toBeUndefined();
  });

  it("propaga el error del AuthPort sin envolverlo ni tragárselo", async () => {
    const port = new RecordingAuthPort(() => Promise.reject(new Error("network error")));
    const useCase = new SignOutUseCase(port);

    await expect(useCase.execute()).rejects.toThrow("network error");
  });
});
