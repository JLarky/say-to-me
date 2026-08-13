import { eq } from "drizzle-orm";
import webpush from "web-push";
import { vapidPrivateKey, vapidPublicKey, vapidSubject } from "./config.ts";
import { pushSubscriptions as pushSubscriptionsTable } from "./db/drizzle-schema.ts";
import { drizzleDb } from "./db/index.ts";
import { DbPushSubscription, validateDb } from "./db/schemas.ts";
import { recordNotification } from "./notification-history.ts";
import { sessionHref } from "./session-id.ts";

interface PushError {
  statusCode?: number;
  message?: string;
}

function ensureVapidConfigured(): boolean {
  const publicKey = vapidPublicKey();
  const privateKey = vapidPrivateKey();
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(vapidSubject(), publicKey, privateKey);
  return true;
}

type PushSubscriptionData = { endpoint: string; keys: { p256dh: string; auth: string } };

// Subscriptions are persisted (not in-memory) so they survive restarts.
export function savePushSubscription(sub: PushSubscriptionData): void {
  drizzleDb
    .insert(pushSubscriptionsTable)
    .values({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    })
    .run();
}

export function hasPushSubscription(endpoint: string): boolean {
  return !!drizzleDb
    .select({ endpoint: pushSubscriptionsTable.endpoint })
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint))
    .limit(1)
    .get();
}

export function listPushSubscriptions(): PushSubscriptionData[] {
  return drizzleDb
    .select()
    .from(pushSubscriptionsTable)
    .all()
    .map((row) => validateDb(DbPushSubscription, row, "pushSubscription"))
    .map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }));
}

function deletePushSubscription(endpoint: string): void {
  drizzleDb
    .delete(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint))
    .run();
}

// In-app notification (the top-right notification panel / audit log). Always
// recorded for agent messages, independent of browser push.
export function recordInAppNotification(sessionId: string, text: string): void {
  recordNotification({ sessionId, title: "say-to-me", body: text, url: sessionHref(sessionId) });
}

// Browser (VAPID/web-push) notification. Only sent for high-signal messages
// that carry an explicit pushNotificationText, and only when the app has a
// global push subscription configured.
export async function sendBrowserPush(sessionId: string, text: string): Promise<void> {
  const title = "say-to-me";
  const url = sessionHref(sessionId);
  if (!ensureVapidConfigured()) return;
  const subs = listPushSubscriptions();
  if (subs.length === 0) return;
  const payload = JSON.stringify({
    title,
    body: text,
    tag: sessionId,
    url,
  });
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        const pushErr = err as PushError;
        const status = pushErr.statusCode;
        if (status === 404 || status === 410) {
          console.error("[push] subscription gone, removing:", sub.endpoint);
          deletePushSubscription(sub.endpoint);
        } else {
          console.error(
            "[push] transient error, keeping subscription:",
            pushErr.statusCode || pushErr.message,
          );
        }
      }
    }),
  );
}
