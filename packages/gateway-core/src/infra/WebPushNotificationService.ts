import webpush from "web-push";
import type { Notification } from "../domain/entities/Notification";
import type { NotificationServicePort } from "../domain/ports/NotificationServicePort";
import type { WebPushSubscriptionStorePort } from "@kan/core";
import type { LoggerPort } from "@kan/plugin-contract";
import { ConsoleLogger } from "./ConsoleLogger";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Web Push (VAPID, sin servicio externo de pago) — mismo rol que
 * `ExpoNotificationService` pero para `apps/web` en vez de `apps/mobile`
 * (Expo Push no sirve para browser). El título queda siempre "KAN" (pedido
 * explícito: "KAN: [el mismo texto de la alerta]" — el body es
 * `notification.body` tal cual, el service worker de apps/web los renderiza
 * como título en negrita + cuerpo debajo).
 */
export class WebPushNotificationService implements NotificationServicePort {
  constructor(
    private readonly store: WebPushSubscriptionStorePort,
    private readonly vapid: VapidConfig,
    private readonly logger: LoggerPort = new ConsoleLogger(),
  ) {}

  async notify(notification: Notification): Promise<void> {
    let subscriptions;
    try {
      subscriptions = await this.store.list(notification.userId);
    } catch (error) {
      this.logger.warn("[WebPushNotificationService] no se pudieron leer las suscripciones", { error });
      return;
    }
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({ title: "KAN", body: notification.body });

    await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(subscription, payload, {
            vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
          });
        } catch (error) {
          // 404/410: la suscripción ya no existe del lado del browser (el
          // usuario desinstaló, borró datos del sitio, etc.) — se limpia
          // sola en vez de seguir intentando para siempre. Cualquier otro
          // error (red, 5xx del push service) solo se loguea, best-effort,
          // mismo criterio que ExpoNotificationService.
          const statusCode = (error as { statusCode?: number } | undefined)?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.store.remove(notification.userId, subscription.endpoint).catch(() => undefined);
            return;
          }
          this.logger.warn("[WebPushNotificationService] no se pudo mandar el push", { error });
        }
      }),
    );
  }
}
