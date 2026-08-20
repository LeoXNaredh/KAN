"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from "@/components/ui/formStyles";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push/actions";

type Status = "checking" | "unsupported" | "off" | "on";

// Conversión estándar VAPID (base64url -> Uint8Array) — PushManager.subscribe()
// exige el applicationServerKey en este formato, no el string tal cual.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

/**
 * Activar/desactivar notificaciones push (Web Push, VAPID) — el mismo canal
 * que ya usa AlertMonitor del lado del Gateway (WebPushNotificationService).
 * Sin NEXT_PUBLIC_VAPID_PUBLIC_KEY configurada, o sin soporte del browser
 * (Service Worker/Push API), no se rompe: se avisa en texto simple en vez
 * de mostrar un botón que nunca podría funcionar.
 */
export function PushNotificationToggle() {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration("/sw.js");
        const subscription = await registration?.pushManager.getSubscription();
        if (!cancelled) setStatus(subscription ? "on" : "off");
      } catch {
        if (!cancelled) setStatus("off");
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleActivate() {
    setError(null);
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Necesitás dar permiso de notificaciones en el navegador para activar esto.");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast: TS (lib.dom más nueva) tipa Uint8Array como ArrayBufferLike
        // genérico, que ya no matchea BufferSource sin ayuda — en runtime es
        // exactamente lo que PushManager.subscribe() espera.
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) as BufferSource,
      });

      const result = await subscribeToPush(subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStatus("on");
    } catch {
      setError("No se pudo activar las notificaciones push.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate() {
    setError(null);
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await unsubscribeFromPush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus("off");
    } catch {
      setError("No se pudo desactivar las notificaciones push.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") return null;

  if (status === "unsupported") {
    return <p className="text-xs text-ink-faint">Tu navegador no soporta notificaciones push, o KAN todavía no las tiene configuradas.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {status === "on" ? (
        <button type="button" disabled={busy} onClick={handleDeactivate} className={`self-start ${SECONDARY_BUTTON_CLASSES}`}>
          <span className="flex items-center gap-1.5">
            <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
            {busy ? "Desactivando…" : "Desactivar notificaciones push"}
          </span>
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={handleActivate} className={`self-start ${PRIMARY_BUTTON_CLASSES}`}>
          <span className="flex items-center gap-1.5">
            <Bell className="h-3.5 w-3.5" aria-hidden="true" />
            {busy ? "Activando…" : "Activar notificaciones push"}
          </span>
        </button>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
