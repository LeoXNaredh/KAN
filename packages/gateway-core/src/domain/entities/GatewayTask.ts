export type GatewayTaskStatus = "dispatched" | "done" | "failed" | "pending_confirmation";

export interface GatewayTask {
  id: string;
  capabilityRef: string;
  status: GatewayTaskStatus;
  createdAt: string;
}

export interface TaskRequest {
  capabilityRef: string;
  input: unknown;
}

export interface TaskResult {
  status: "done" | "failed" | "pending_confirmation";
  data?: unknown;
  error?: string;
  confirmationId?: string;
}
