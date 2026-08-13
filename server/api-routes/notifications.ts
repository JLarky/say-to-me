import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import { dismissNotification, notificationPayload } from "../notification-history.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const NotificationPath = Schema.Struct({
  notificationId: Schema.String.annotations({ description: "Notification identifier." }),
});

const NotificationsPayload = Schema.Struct({
  notifications: Schema.Array(Schema.Unknown),
});

const NotificationValidationError = Schema.Struct({
  _tag: Schema.Literal("NotificationValidationError"),
  error: Schema.String,
  status: Schema.Number,
});

const NotificationNotFoundError = Schema.Struct({
  _tag: Schema.Literal("NotificationNotFoundError"),
  error: Schema.String,
  status: Schema.Number,
});

type NotificationsPayload = Schema.Schema.Type<typeof NotificationsPayload>;
type NotificationValidationError = Schema.Schema.Type<typeof NotificationValidationError>;
type NotificationNotFoundError = Schema.Schema.Type<typeof NotificationNotFoundError>;

export type NotificationService = {
  dismiss: (id: number) => Effect.Effect<boolean>;
  payload: () => Effect.Effect<NotificationsPayload>;
};

export const Notifications = Context.GenericTag<NotificationService>("say-to-me/Notifications");

export const NotificationsLive = Layer.succeed(Notifications, {
  dismiss: (id) => Effect.sync(() => dismissNotification(id)),
  payload: () => Effect.sync(() => notificationPayload()),
} satisfies NotificationService);

export function listNotificationsEffect(): Effect.Effect<
  NotificationsPayload,
  never,
  NotificationService
> {
  return Effect.gen(function* () {
    const notifications = yield* Notifications;
    return yield* notifications.payload();
  });
}

export function dismissNotificationEffect(
  rawNotificationId: string,
): Effect.Effect<
  NotificationsPayload,
  NotificationNotFoundError | NotificationValidationError,
  NotificationService
> {
  return Effect.gen(function* () {
    const notificationId = Number(rawNotificationId);
    if (!Number.isSafeInteger(notificationId) || notificationId <= 0) {
      return yield* Effect.fail({
        _tag: "NotificationValidationError" as const,
        error: "Invalid notification id.",
        status: 400,
      });
    }

    const notifications = yield* Notifications;
    const dismissed = yield* notifications.dismiss(notificationId);
    if (!dismissed) {
      return yield* Effect.fail({
        _tag: "NotificationNotFoundError" as const,
        error: "Notification not found.",
        status: 404,
      });
    }

    return yield* notifications.payload();
  });
}

export const NotificationsGroup = HttpApiGroup.make("notifications")
  .add(
    HttpApiEndpoint.get("listNotifications", "/api/notifications")
      .annotateContext(
        openApiDocs(
          "List notifications",
          "Returns the current in-app notification feed for the client.",
        ),
      )
      .addSuccess(NotificationsPayload),
  )
  .add(
    HttpApiEndpoint.del("dismissNotification", "/api/notifications/:notificationId")
      .setPath(NotificationPath)
      .annotateContext(
        openApiDocs(
          "Dismiss a notification",
          "Marks a notification as dismissed and returns the updated notification list.",
        ),
      )
      .addSuccess(NotificationsPayload)
      .addError(NotificationValidationError, { status: 400 })
      .addError(NotificationNotFoundError, { status: 404 }),
  );

export const NotificationsApi = HttpApi.make("notifications").add(NotificationsGroup);

export function buildNotificationsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof NotificationsGroup, E, R>,
    "notifications",
    (handlers) =>
      handlers
        .handle("listNotifications", () => listNotificationsEffect())
        .handle("dismissNotification", ({ path }) =>
          dismissNotificationEffect(path.notificationId).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        ),
  );
}
