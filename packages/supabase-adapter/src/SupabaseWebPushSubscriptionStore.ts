import type { SupabaseClient } from "@supabase/supabase-js";
import type { WebPushSubscription, WebPushSubscriptionStorePort } from "@kan/core";

interface WebPushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

/** Adaptador de WebPushSubscriptionStorePort sobre `web_push_subscriptions` — mismo patrón que `SupabasePushTokenStore`, tabla separada porque el shape de datos es distinto (endpoint + par de claves, no un token simple). */
export class SupabaseWebPushSubscriptionStore implements WebPushSubscriptionStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async register(userId: string, subscription: WebPushSubscription): Promise<void> {
    const { error } = await this.client.from("web_push_subscriptions").upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth_key: subscription.keys.auth,
      },
      { onConflict: "user_id,endpoint" },
    );
    if (error) throw new Error(error.message);
  }

  async list(userId: string): Promise<WebPushSubscription[]> {
    const { data, error } = await this.client
      .from("web_push_subscriptions")
      .select("endpoint, p256dh, auth_key")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as WebPushSubscriptionRow[]).map((row) => ({
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth_key },
    }));
  }

  async remove(userId: string, endpoint: string): Promise<void> {
    const { error } = await this.client
      .from("web_push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", endpoint);
    if (error) throw new Error(error.message);
  }
}
