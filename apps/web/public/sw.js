// Service worker de Web Push (sin build/bundler, JS plano — mismo criterio
// que public/audio/pcm16-capture-worklet.js) — solo recibe pushes y los
// muestra; el registro/suscripción vive en components/configuracion/
// PushNotificationToggle.tsx. El payload ya viene armado del lado del
// Gateway como { title: "KAN", body: "<texto de la alerta>" } (ver
// WebPushNotificationService), nunca JSON crudo sin traducir.

self.addEventListener("push", (event) => {
  let data = { title: "KAN", body: "Tenés una notificación nueva." };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // Payload no-JSON (no debería pasar, ver WebPushNotificationService) — se usa el default de arriba.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.ico",
      tag: "kan-alert",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    }),
  );
});
