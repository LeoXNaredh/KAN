import type { CoreToEdgeMessage, EdgeToCoreMessage } from "@kan/plugin-contract";

export type CoreConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface CoreConnectionPort {
  readonly status: CoreConnectionStatus;
  start(): void;
  stop(): void;
  send(message: EdgeToCoreMessage): void;
  onMessage(handler: (message: CoreToEdgeMessage) => void): void;
  onStatusChange(handler: (status: CoreConnectionStatus) => void): void;
}
