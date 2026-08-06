/** Seam (docs/12 §9) — sin envío real todavía, ver ConsoleNotificationService. */
export type NotificationChannel = "chat" | "push" | "email" | "sms";
export type NotificationSeverity = "info" | "warning" | "critical";

export interface Notification {
  userId: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  severity?: NotificationSeverity;
}
