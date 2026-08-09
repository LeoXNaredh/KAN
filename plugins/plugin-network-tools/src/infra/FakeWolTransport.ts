import type { WolTransportPort } from "../WolTransportPort";
import { buildMagicPacket } from "../magicPacket";

/** Fake en memoria para tests del plugin — igual valida el formato del magic packet (falla si la MAC es inválida). */
export class FakeWolTransport implements WolTransportPort {
  public readonly sentPackets: Array<{ macAddress: string; broadcastAddress: string; port: number }> = [];

  async sendMagicPacket(macAddress: string, broadcastAddress: string, port: number): Promise<void> {
    buildMagicPacket(macAddress); // valida formato, tira si es inválida — mismo comportamiento que el real
    this.sentPackets.push({ macAddress, broadcastAddress, port });
  }
}
