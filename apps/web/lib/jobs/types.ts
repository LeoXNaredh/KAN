/** Mismo shape que ScheduledJob en @kan/gateway-core — sin traducción, es un pass-through BFF (P6). */
export interface ScheduledJobView {
  id: string;
  taskRequest: { capabilityRef: string; input: unknown };
  cron?: string;
  runAt?: string;
}

export interface JobsListResponse {
  jobs: ScheduledJobView[];
  gatewayOnline: boolean;
}
