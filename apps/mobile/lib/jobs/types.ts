// Mismo shape que apps/web/lib/jobs/types.ts (docs/18, incremento 6) —
// espejo escrito a mano, no un import de @kan/gateway-core: ese paquete
// tiene dependencias de Node (node-cron) pensadas para el proceso del
// Gateway, no para bundlear en un cliente móvil (mismo criterio que evitó
// que apps/mobile dependiera de @kan/ai-abstraction, docs/18 §6).
export interface JobStepView {
  capabilityRef: string;
  input: unknown;
}

export interface JobNotificationView {
  title: string;
  body: string;
}

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

export interface ToolSummary {
  name: string;
  description: string;
}
