import type { Notification } from "../domain/entities/Notification";
import type { NotificationServicePort } from "../domain/ports/NotificationServicePort";

/**
 * Fan-out a varios `NotificationServicePort` (hoy: Expo + Web Push) sin que
 * `Gateway.ts`/`AlertMonitor.ts` sepan que existe más de uno — siguen
 * llamando a un único `notificationService.notify(...)` por alerta
 * disparada. En paralelo (`Promise.allSettled`, nunca lanza): que un canal
 * falle no debe impedir que los demás intenten avisar igual.
 */
export class CompositeNotificationService implements NotificationServicePort {
  constructor(private readonly services: NotificationServicePort[]) {}

  async notify(notification: Notification): Promise<void> {
    await Promise.allSettled(this.services.map((service) => service.notify(notification)));
  }
}
