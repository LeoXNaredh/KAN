import type { PairingCode, PairingPort } from "../../domain/ports/PairingPort";

export class GeneratePairingCodeUseCase {
  constructor(private readonly pairingPort: PairingPort) {}

  execute(userId: string): Promise<PairingCode> {
    return this.pairingPort.generateCode(userId);
  }
}
