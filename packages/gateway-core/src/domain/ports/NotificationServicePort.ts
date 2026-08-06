import type { Notification } from "../entities/Notification";

export interface NotificationServicePort {
  notify(notification: Notification): Promise<void>;
}
