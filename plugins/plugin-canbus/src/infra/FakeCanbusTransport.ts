import type { CanbusConnection, CanbusTransportPort } from "../CanbusTransportPort";
import { bitrateToSlcanCommand, decodeFrame, encodeFrame, type CanFrame } from "../SlcanCodec";

export interface FakeChannelConfig {
  /** Si es `false`, openChannel() a este puerto falla (simula un puerto/adaptador inexistente). */
  reachable?: boolean;
}

/**
 * Adaptador SLCAN simulado — a diferencia del fake "tonto" de
 * plugin-serial-generic, este SÍ conoce el protocolo (como el fake de
 * plugin-esp32-arduino, que interpreta JSON): responde al handshake de
 * bitrate/apertura de canal como lo haría un adaptador real, para que los
 * tests de `CanbusDevicePlugin` ejerciten el flujo completo sin depender
 * del handshake real de `SlcanTransport` (eso lo cubre por separado
 * `SlcanCodec.test.ts` con el formato exacto verificado contra python-can).
 */
export class FakeCanbusTransport implements CanbusTransportPort {
  public readonly sentFrames: Array<{ path: string; frame: CanFrame }> = [];
  private readonly frameHandlersByPath = new Map<string, Set<(frame: CanFrame) => void>>();

  constructor(private readonly channels: Record<string, FakeChannelConfig> = {}) {}

  async openChannel(path: string, bitrate: number): Promise<CanbusConnection> {
    if (this.channels[path]?.reachable === false) throw new Error(`No se pudo abrir el canal CAN: ${path}`);
    if (!bitrateToSlcanCommand(bitrate)) throw new Error(`Bitrate no soportado por SLCAN: ${bitrate}`);

    if (!this.frameHandlersByPath.has(path)) this.frameHandlersByPath.set(path, new Set());
    const frameHandlers = this.frameHandlersByPath.get(path)!;
    let open = true;

    return {
      sendFrame: async (frame: CanFrame) => {
        if (!open) throw new Error("Canal cerrado");
        const encoded = encodeFrame(frame);
        if (!encoded.ok) throw new Error(encoded.error);
        this.sentFrames.push({ path, frame });
      },
      onFrame: (handler) => {
        frameHandlers.add(handler);
        return () => frameHandlers.delete(handler);
      },
      close: async () => {
        open = false;
      },
    };
  }

  /** Simula una trama entrante del bus (otro nodo real transmitiendo) — para tests. */
  simulateIncoming(path: string, frame: CanFrame): void {
    const encoded = encodeFrame(frame);
    if (!encoded.ok) throw new Error(encoded.error);
    const decoded = decodeFrame(encoded.line);
    if (!decoded) throw new Error("No se pudo decodificar la trama simulada");
    this.frameHandlersByPath.get(path)?.forEach((handler) => handler(decoded));
  }
}
