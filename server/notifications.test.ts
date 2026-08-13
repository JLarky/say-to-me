import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { Effect, Layer } from "effect";
import {
  type TestServer,
  clearQueue,
  createApiMiddleware,
  listen,
  teardownApi,
} from "./api.harness.ts";
import {
  Notifications,
  dismissNotificationEffect,
  listNotificationsEffect,
  type NotificationService,
} from "./api-routes/notifications.ts";
import { dispatchEffectApiRequest } from "./api-routes/effect-api.ts";
import { notificationPayload, recordNotification } from "./notification-history.ts";
import {
  NotificationWatchRepository,
  NotificationWatchScheduler,
  type NotificationWatchRepositoryService,
  type NotificationWatchSchedulerService,
  type ResumableNotificationWatch,
  resumeNotificationWatchesEffect,
} from "./notifications.ts";

function makeLayers(watches: ResumableNotificationWatch[]) {
  const scheduled: ResumableNotificationWatch[] = [];
  const repository = Layer.succeed(NotificationWatchRepository, {
    listResumable: () => Effect.succeed(watches),
  } satisfies NotificationWatchRepositoryService);
  const scheduler = Layer.succeed(NotificationWatchScheduler, {
    startIdle: (watch) => Effect.sync(() => scheduled.push(watch)),
    startForwardCompletion: (watch) => Effect.sync(() => scheduled.push(watch)),
  } satisfies NotificationWatchSchedulerService);
  return { layer: Layer.mergeAll(repository, scheduler), scheduled };
}

describe("notification watch resume effect", () => {
  it("schedules every resumable watch through injected services", async () => {
    const watches: ResumableNotificationWatch[] = [
      { kind: "idle", sessionId: "ses_09a0fc08523fctVzW8czyW9yAN", triggerMessageId: 10 },
      {
        kind: "forward_completion",
        sourceMessageId: 20,
        sourceSessionId: "ses_8405d94c25237k1ihS8Zxf8qJM",
        targetMessageId: 21,
        targetSessionId: "ses_6cd0c26c5a6ffCEvwKoLI2Z5kM",
      },
    ];
    const { layer, scheduled } = makeLayers(watches);

    await Effect.runPromise(resumeNotificationWatchesEffect().pipe(Effect.provide(layer)));

    expect(scheduled).toEqual(watches);
  });

  it("does nothing when the repository has no resumable watches", async () => {
    const { layer, scheduled } = makeLayers([]);

    await Effect.runPromise(resumeNotificationWatchesEffect().pipe(Effect.provide(layer)));

    expect(scheduled).toEqual([]);
  });
});

function notificationLayer(service: NotificationService) {
  return Layer.succeed(Notifications, service);
}

describe("notification dismiss effect", () => {
  it("lists notifications through the injected service", async () => {
    const calls: string[] = [];
    const payload = { notifications: [{ id: 1, title: "active" }] };
    const layer = notificationLayer({
      dismiss: () => Effect.succeed(true),
      payload: () =>
        Effect.sync(() => {
          calls.push("payload");
          return payload;
        }),
    });

    await expect(
      Effect.runPromise(listNotificationsEffect().pipe(Effect.provide(layer))),
    ).resolves.toEqual(payload);
    expect(calls).toEqual(["payload"]);
  });

  it("dismisses a notification and returns the current notification payload", async () => {
    const calls: string[] = [];
    const payload = { notifications: [{ id: 2, title: "still active" }] };
    const layer = notificationLayer({
      dismiss: (id) =>
        Effect.sync(() => {
          calls.push(`dismiss:${id}`);
          return true;
        }),
      payload: () =>
        Effect.sync(() => {
          calls.push("payload");
          return payload;
        }),
    });

    await expect(
      Effect.runPromise(dismissNotificationEffect("1").pipe(Effect.provide(layer))),
    ).resolves.toEqual(payload);
    expect(calls).toEqual(["dismiss:1", "payload"]);
  });

  it("validates ids before touching the notification service", async () => {
    const calls: string[] = [];
    const layer = notificationLayer({
      dismiss: (id) =>
        Effect.sync(() => {
          calls.push(`dismiss:${id}`);
          return true;
        }),
      payload: () => Effect.succeed({ notifications: [] }),
    });

    await expect(
      Effect.runPromiseExit(dismissNotificationEffect("0").pipe(Effect.provide(layer))),
    ).resolves.toMatchObject({
      _tag: "Failure",
      cause: {
        _tag: "Fail",
        error: {
          _tag: "NotificationValidationError",
          error: "Invalid notification id.",
          status: 400,
        },
      },
    });
    expect(calls).toEqual([]);
  });

  it("returns not found when the notification service cannot dismiss the id", async () => {
    const layer = notificationLayer({
      dismiss: () => Effect.succeed(false),
      payload: () => Effect.succeed({ notifications: [] }),
    });

    await expect(
      Effect.runPromiseExit(dismissNotificationEffect("404").pipe(Effect.provide(layer))),
    ).resolves.toMatchObject({
      _tag: "Failure",
      cause: {
        _tag: "Fail",
        error: {
          _tag: "NotificationNotFoundError",
          error: "Notification not found.",
          status: 404,
        },
      },
    });
  });

  it("registers notification list and dismiss routes in the Effect route table", async () => {
    expect(
      await dispatchEffectApiRequest(new Request("http://say.local/api/notifications")),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/notifications/1", { method: "DELETE" }),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(new Request("http://say.local/api/notifications/events")),
    ).toBeNull();
  });
});

describe("say API: notification dismiss", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("lists notifications through the Effect HttpApi route", async () => {
    try {
      recordNotification({
        body: "Done",
        sessionId: "ses_78fbaa6215e9u9tdd8kATtuVTA_list",
        title: "Notification",
        url: "/sessions/ses_78fbaa6215e9u9tdd8kATtuVTA_list",
      });

      const response = await fetch(`${origin}/api/notifications`);

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        notifications: [
          expect.objectContaining({
            body: "Done",
            sessionId: "ses_78fbaa6215e9u9tdd8kATtuVTA_list",
            title: "Notification",
            url: "/sessions/ses_78fbaa6215e9u9tdd8kATtuVTA_list",
          }),
        ],
      });
    } finally {
      server.close();
    }
  });

  it("dismisses notifications through the Effect HttpApi route", async () => {
    try {
      recordNotification({
        body: "Done",
        sessionId: "ses_78fbaa6215e9u9tdd8kATtuVTA",
        title: "Notification",
        url: "/sessions/ses_78fbaa6215e9u9tdd8kATtuVTA",
      });
      const [notification] = notificationPayload().notifications;
      expect(notification).toMatchObject({
        sessionId: "ses_78fbaa6215e9u9tdd8kATtuVTA",
        dismissedAt: null,
      });

      const response = await fetch(`${origin}/api/notifications/${notification.id}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ notifications: [] });
    } finally {
      server.close();
    }
  });

  it("keeps legacy public error shapes for invalid and missing notification ids", async () => {
    try {
      const invalid = await fetch(`${origin}/api/notifications/not-a-number`, {
        method: "DELETE",
      });
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toEqual({
        error: "Invalid notification id.",
        status: 400,
      });

      const missing = await fetch(`${origin}/api/notifications/999`, { method: "DELETE" });
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toEqual({
        error: "Notification not found.",
        status: 404,
      });
    } finally {
      server.close();
    }
  });
});
