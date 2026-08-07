export interface JobStepView {
  capabilityRef: string;
  input: unknown;
}

export interface JobNotificationView {
  title: string;
  body: string;
}

/** Mismo shape que ScheduledJob en @kan/gateway-core — sin traducción, es un pass-through BFF (P6/ADR-021). */
export interface ScheduledJobView {
  id: string;
  steps: JobStepView[];
  notification?: JobNotificationView;
  cron?: string;
  runAt?: string;
}

export interface JobsListResponse {
  jobs: ScheduledJobView[];
  gatewayOnline: boolean;
}
