import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Schema } from "effect";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const PushSubscriptionPayload = Schema.Unknown;

const VapidPublicKey = Schema.Struct({
  publicKey: Schema.String,
});

const PushSubscribed = Schema.Struct({
  ok: Schema.Literal(true),
});

const PushSubscriptionStatus = Schema.Struct({
  subscribed: Schema.Boolean,
});

const PushValidationError = Schema.Struct({
  _tag: Schema.Literal("PushValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const PushNotConfiguredError = Schema.Struct({
  _tag: Schema.Literal("PushNotConfiguredError"),
  error: Schema.String,
  status: Schema.Number,
});

type VapidPublicKey = Schema.Schema.Type<typeof VapidPublicKey>;
type PushSubscribed = Schema.Schema.Type<typeof PushSubscribed>;
type PushSubscriptionStatus = Schema.Schema.Type<typeof PushSubscriptionStatus>;
type PushValidationError = Schema.Schema.Type<typeof PushValidationError>;
type PushNotConfiguredError = Schema.Schema.Type<typeof PushNotConfiguredError>;

type PushSubscriptionLike = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushService = {
  publicKey: () => Effect.Effect<string | null>;
  subscribe: (subscription: PushSubscriptionLike) => Effect.Effect<void>;
  isSubscribed: (endpoint: string) => Effect.Effect<boolean>;
};

export const Push = Context.GenericTag<PushService>("say-to-me/Push");

export function getVapidPublicKeyEffect(): Effect.Effect<
  VapidPublicKey,
  PushNotConfiguredError,
  PushService
> {
  return Effect.gen(function* () {
    const push = yield* Push;
    const publicKey = yield* push.publicKey();
    if (!publicKey) {
      return yield* Effect.fail({
        _tag: "PushNotConfiguredError" as const,
        error: "VAPID not configured.",
        status: 404,
      });
    }
    return { publicKey };
  });
}

export function subscribeToPushEffect(
  payload: unknown,
): Effect.Effect<PushSubscribed, PushNotConfiguredError | PushValidationError, PushService> {
  return Effect.gen(function* () {
    const push = yield* Push;
    const publicKey = yield* push.publicKey();
    if (!publicKey) {
      return yield* Effect.fail({
        _tag: "PushNotConfiguredError" as const,
        error: "VAPID not configured.",
        status: 404,
      });
    }

    const p = payload as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof p.endpoint !== "string" ||
      !p.keys ||
      typeof p.keys !== "object" ||
      typeof p.keys.p256dh !== "string" ||
      typeof p.keys.auth !== "string"
    ) {
      return yield* Effect.fail({
        _tag: "PushValidationError" as const,
        error: "Invalid subscription.",
        status: 400,
      });
    }

    yield* push.subscribe(payload as PushSubscriptionLike);
    return { ok: true };
  });
}

// In-memory subscriptions are dropped on restart; the client polls this to know
// it must re-subscribe.
export function checkPushSubscriptionEffect(
  payload: unknown,
): Effect.Effect<PushSubscriptionStatus, PushValidationError, PushService> {
  return Effect.gen(function* () {
    const p = payload as { endpoint?: unknown };
    if (!payload || typeof payload !== "object" || typeof p.endpoint !== "string") {
      return yield* Effect.fail({
        _tag: "PushValidationError" as const,
        error: "Invalid subscription endpoint.",
        status: 400,
      });
    }
    const push = yield* Push;
    const subscribed = yield* push.isSubscribed(p.endpoint);
    return { subscribed };
  });
}

export const PushGroup = HttpApiGroup.make("push")
  .add(
    HttpApiEndpoint.get("getVapidPublicKey", "/api/vapid-public-key")
      .annotateContext(
        openApiDocs(
          "Get VAPID public key",
          "Returns the Web Push VAPID public key used by the browser to subscribe.",
        ),
      )
      .addSuccess(VapidPublicKey)
      .addError(PushNotConfiguredError, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.post("subscribeToPush", "/api/push-subscribe")
      .setPayload(PushSubscriptionPayload)
      .annotateContext(
        openApiDocs(
          "Subscribe to web push",
          "Registers a browser push subscription endpoint for later notifications.",
        ),
      )
      .addSuccess(PushSubscribed)
      .addError(PushValidationError, { status: 400 })
      .addError(PushNotConfiguredError, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.post("checkPushSubscription", "/api/push-status")
      .setPayload(PushSubscriptionPayload)
      .annotateContext(
        openApiDocs(
          "Check push subscription",
          "Reports whether the given push endpoint is currently registered.",
        ),
      )
      .addSuccess(PushSubscriptionStatus)
      .addError(PushValidationError, { status: 400 }),
  );

export const PushApi = HttpApi.make("push").add(PushGroup);

export function buildPushHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing PushGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof PushGroup, E, R>,
    "push",
    (handlers) =>
      handlers
        .handle("getVapidPublicKey", () =>
          getVapidPublicKeyEffect().pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("subscribeToPush", ({ payload }) =>
          subscribeToPushEffect(payload).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("checkPushSubscription", ({ payload }) =>
          checkPushSubscriptionEffect(payload).pipe(Effect.catchAll(publicRouteErrorResponse)),
        ),
  );
}
