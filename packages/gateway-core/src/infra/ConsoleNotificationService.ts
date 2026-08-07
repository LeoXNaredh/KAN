import type { LoggerPort } from "@kan/plugin-contract";
import type { Notification } from "../domain/entities/Notification";
import type { NotificationServicePort } from "../domain/ports/NotificationServicePort";
import { ConsoleLogger } from "./ConsoleLogger";

/** Seam del requisito 9 (docs/12 §9) — solo loguea, no envía nada real todavía. */
export class ConsoleNotificationService implements NotificationServicePort {
  constructor(private readonly logger: LoggerPort = new ConsoleLogger()) {}

  async notify(notification: Notification): Promise<void> {
    this.logger.info(`[ConsoleNotificationService] (${notification.channel}) ${notification.title}: ${notification.body}`);
  }
}
