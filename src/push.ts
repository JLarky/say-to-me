import { type as arktype } from "arktype";
import { safeResponseJson } from "@say-to-me/runtime-validation";

let swRegistration: ServiceWorkerRegistration | null = null;

const PushStatusPayload = arktype({
  "subscribed?": "boolean",
});

const VapidPublicKeyPayload = arktype({
  publicKey: "string",
});

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  if (swRegistration) return swRegistration;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js");
    return swRegistration;
  } catch (err) {
    console.error("[sw] registration failed:", err);
    return null;
  }
}

// Whether the server still has this browser's (in-memory) subscription; false
// on any failure so the UI errs toward prompting a re-subscribe.
export async function isPushKnownToServer(reg = swRegistration): Promise<boolean> {
  if (!reg) return false;
  try {
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return false;
    const res = await fetch("/api/push-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
    if (!res.ok) return false;
    const data = await safeResponseJson(res, PushStatusPayload);
    return data.subscribed === true;
  } catch (err) {
    console.error("[push] status check failed:", err);
    return false;
  }
}

export async function subscribeToPush(reg = swRegistration): Promise<void> {
  if (!reg) return;
  try {
    const keyRes = await fetch("/api/vapid-public-key");
    if (!keyRes.ok) return;
    const { publicKey } = await safeResponseJson(keyRes, VapidPublicKeyPayload);
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });
    await fetch("/api/push-subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });
  } catch (err) {
    console.error("[push] subscribe failed:", err);
  }
}
