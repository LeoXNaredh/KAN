import type { CanFrame } from "./SlcanCodec";

export interface CanbusConnection {
  sendFrame(frame: CanFrame): Promise<void>;
  /** Devuelve una función para dejar de escuchar. */
  onFrame(handler: (frame: CanFrame) => void): () => void;
  close(): Promise<void>;
}

export interface CanbusTransportPort {
  /** Abre el puerto serial, hace el handshake SLCAN (bitrate + open channel) y deja el bus escuchando. */
  openChannel(path: string, bitrate: number): Promise<CanbusConnection>;
}
