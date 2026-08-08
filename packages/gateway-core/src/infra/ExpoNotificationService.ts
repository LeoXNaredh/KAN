import type { LoggerPort } from "@kan/plugin-contract";
import type { PushTokenStorePort } from "@kan/core";
import type { Notification } from "../domain/entities/Notification";
import type { NotificationServicePort } from "../domain/ports/NotificationServicePort";
import { ConsoleLogger } from "./ConsoleLogger";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

/**
 * Reemplaza a ConsoleNotificationService en producción (P7, ADR-040):
 * busca los tokens Expo del usuario del job vía PushTokenStorePort y les
 * manda un push real. Best-effort — nunca lanza (mismo criterio que rige
 * `notify()` en todo el proyecto): sin tokens, o si Expo devuelve error,
 * solo loguea y sigue. `notification.userId === "system"` (jobs sin
 * `createdBy`, ver ScheduledJob) nunca tiene tokens propios, así que
 * degrada limpio a "sin tokens" sin caso especial.
 */
export class ExpoNotificationService implements NotificationServicePort {
  constructor(
    private readonly pushTokenStore: PushTokenStorePort,
    private readonly logger: LoggerPort = new ConsoleLogger(),
  ) {}

  async notify(notification: Notification): Promise<void> {
    try {
      const tokens = await this.pushTokenStore.list(notification.userId);
      if (!tokens.length) {
        this.logger.info(`[ExpoNotificationService] sin tokens para ${notification.userId}, no se manda push`);
        return;
      }

      const response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(
          tokens.map((to) => ({ to, title: notification.title, body: notification.body })),
        ),
      });

      if (!response.ok) {
        this.logger.warn(`[ExpoNotificationService] Expo respondió ${response.status} al mandar el push`);
      }
    } catch (error) {
      this.logger.warn("[ExpoNotificationService] no se pudo mandar el push", { error });
    }
  }
}
