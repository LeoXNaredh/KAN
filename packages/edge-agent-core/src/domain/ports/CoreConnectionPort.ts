import type { CoreToEdgeMessage, EdgeToCoreMessage } from "@kan/plugin-contract";

export type CoreConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";
export type Unsubscribe = () => void;

export interface CoreConnectionPort {
  readonly status: CoreConnectionStatus;
  start(): void;
  stop(): void;
  send(message: EdgeToCoreMessage): void;
  onMessage(handler: (message: CoreToEdgeMessage) => void): Unsubscribe;
  onStatusChange(handler: (status: CoreConnectionStatus) => void): Unsubscribe;
}
