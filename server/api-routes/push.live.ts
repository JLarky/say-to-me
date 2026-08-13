import { Effect, Layer } from "effect";
import { vapidPublicKey } from "../config.ts";
import { hasPushSubscription, savePushSubscription } from "../push.ts";
import { Push, type PushService } from "./push.ts";

export const PushLive = Layer.succeed(Push, {
  publicKey: () => Effect.succeed(vapidPublicKey() ?? null),
  subscribe: (subscription) => Effect.sync(() => savePushSubscription(subscription)),
  isSubscribed: (endpoint) => Effect.sync(() => hasPushSubscription(endpoint)),
} satisfies PushService);
