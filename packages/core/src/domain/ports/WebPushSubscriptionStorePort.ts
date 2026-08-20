/** Shape estándar de una suscripción Web Push del browser (`PushSubscription.toJSON()`) — distinto de un token de Expo, nunca un string simple. */
export interface WebPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Suscripciones de Web Push por usuario (mismo criterio que
 * `PushTokenStorePort`, pero para `apps/web` en vez de `apps/mobile`) —
 * usado tanto por `apps/web` (registro, sesión propia) como por el Gateway
 * (lectura, service_role) al mandar una notificación.
 */
export interface WebPushSubscriptionStorePort {
  register(userId: string, subscription: WebPushSubscription): Promise<void>;
  list(userId: string): Promise<WebPushSubscription[]>;
  remove(userId: string, endpoint: string): Promise<void>;
}
