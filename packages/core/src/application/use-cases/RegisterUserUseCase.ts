import type { AuthPort, PasswordCredentials } from "../../domain/ports/AuthPort";
import type { UserIdentity } from "../../domain/entities/UserIdentity";

/**
 * Orquestador fino sobre AuthPort (ADR-017): hoy es casi un passthrough,
 * pero es el lugar correcto para lógica futura de registro (ej. sembrar
 * preferencias por defecto) sin que termine en una ruta de Next.
 */
export class RegisterUserUseCase {
  constructor(private readonly authPort: AuthPort) {}

  execute(credentials: PasswordCredentials): Promise<UserIdentity> {
    return this.authPort.registerWithPassword(credentials);
  }
}
