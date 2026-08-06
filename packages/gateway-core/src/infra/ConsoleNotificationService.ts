import type { Notification } from "../domain/entities/Notification";
import type { NotificationServicePort } from "../domain/ports/NotificationServicePort";

/** Seam del requisito 9 (docs/12 §9) — solo loguea, no envía nada real todavía. */
export class ConsoleNotificationService implements NotificationServicePort {
  async notify(notification: Notification): Promise<void> {
    console.log(`[ConsoleNotificationService] (${notification.channel}) ${notification.title}: ${notification.body}`);
  }
}
