import { createSocket } from "node:dgram";
import type { WolTransportPort } from "../WolTransportPort";
import { buildMagicPacket } from "../magicPacket";

export class NodeWolTransport implements WolTransportPort {
  async sendMagicPacket(macAddress: string, broadcastAddress: string, port: number): Promise<void> {
    const packet = buildMagicPacket(macAddress);
    const socket = createSocket("udp4");
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.bind(() => {
          socket.setBroadcast(true);
          socket.send(packet, port, broadcastAddress, (error) => (error ? reject(error) : resolve()));
        });
      });
    } finally {
      socket.close();
    }
  }
}
