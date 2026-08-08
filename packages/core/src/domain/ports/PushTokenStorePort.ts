/** Tokens de push (Expo) por usuario (P7) — usado tanto por apps/mobile (registro, sesión propia) como por el Gateway (lectura, service_role) al mandar una notificación. */
export interface PushTokenStorePort {
  register(userId: string, token: string, platform: "ios" | "android"): Promise<void>;
  list(userId: string): Promise<string[]>;
  remove(userId: string, token: string): Promise<void>;
}
