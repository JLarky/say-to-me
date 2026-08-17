import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Context, Effect, Layer, Schema } from "effect";
import { broadcastQueue } from "../broadcast.ts";
import {
  deleteMessage,
  deleteThread,
  deserializeMessage,
  getMessage,
  prunePlayedHistory,
  setAttachedSession,
  setMessagePinned,
  setMessageStatus,
} from "../messages.ts";
import type { DbMessage } from "../db/schemas.ts";
import {
  enqueueOpenCodeDeliveryJob,
  retryOpenCodeDeliveryJob,
  type EnqueueOpenCodeDeliveryInput,
} from "../opencode/durable-delivery.ts";
import { validateSessionId } from "../session-id.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const MessagePath = Schema.Struct({
  id: Schema.String,
});

const MessageControlPayload = Schema.Unknown;
const MessagePinnedPayload = Schema.Struct({ pinned: Schema.Boolean });

const MessageControlResult = Schema.Struct({
  ok: Schema.Literal(true),
});

const MessagePinnedResult = Schema.Struct({
  ok: Schema.Literal(true),
  pinned: Schema.Boolean,
});

const MessageControlWithMessage = Schema.Struct({
  ok: Schema.Literal(true),
  message: Schema.Unknown,
});

const MessageDeleted = Schema.Void;

const MessageControlError = Schema.Struct({
  error: Schema.String,
});

const MessageControlFailure = Schema.Struct({
  _tag: Schema.Literal("MessageControlError"),
  error: Schema.String,
  status: Schema.Number,
});

type MessageControlResult = Schema.Schema.Type<typeof MessageControlResult>;
type MessageControlWithMessage = Schema.Schema.Type<typeof MessageControlWithMessage>;
type MessageControlError = Schema.Schema.Type<typeof MessageControlFailure>;
type MessagePinnedPayload = Schema.Schema.Type<typeof MessagePinnedPayload>;

export type MessageControlService = {
  getMessage: (id: number) => Effect.Effect<DbMessage | null>;
  retryOpenCodeDeliveryJob: (id: number) => Effect.Effect<boolean>;
  enqueueOpenCodeDeliveryJob: (input: EnqueueOpenCodeDeliveryInput) => Effect.Effect<void>;
  setAttachedSession: (messageId: number, sessionId: string | null) => Effect.Effect<void>;
  setMessagePinned: (messageId: number, pinned: boolean) => Effect.Effect<void>;
  setMessageStatus: (messageId: number, status: string) => Effect.Effect<void>;
  prunePlayedHistory: (sessionId: string) => Effect.Effect<void>;
  deleteMessage: (messageId: number) => Effect.Effect<void>;
  deleteThread: (messageId: number) => Effect.Effect<void>;
  broadcast: (sessionId?: string) => Effect.Effect<void>;
};

export const MessageControl = Context.GenericTag<MessageControlService>("say-to-me/MessageControl");

export const MessageControlLive = Layer.succeed(MessageControl, {
  getMessage: (id) => Effect.sync(() => getMessage(id)),
  retryOpenCodeDeliveryJob: (id) =>
    Effect.sync(() => retryOpenCodeDeliveryJob(id, { force: true }) != null),
  enqueueOpenCodeDeliveryJob: (input) =>
    Effect.sync(() => {
      enqueueOpenCodeDeliveryJob(input);
    }),
  setAttachedSession: (messageId, sessionId) =>
    Effect.sync(() => setAttachedSession(messageId, sessionId)),
  setMessagePinned: (messageId, pinned) => Effect.sync(() => setMessagePinned(messageId, pinned)),
  setMessageStatus: (messageId, status) => Effect.sync(() => setMessageStatus(messageId, status)),
  prunePlayedHistory: (sessionId) => Effect.sync(() => prunePlayedHistory(sessionId)),
  deleteMessage: (messageId) => Effect.sync(() => deleteMessage(messageId)),
  deleteThread: (messageId) => Effect.sync(() => deleteThread(messageId)),
  broadcast: (sessionId) => Effect.sync(() => broadcastQueue(sessionId)),
} satisfies MessageControlService);

function requireMessageId(rawId: string): Effect.Effect<number, MessageControlError> {
  return Effect.gen(function* () {
    const id = Number(rawId);
    if (!Number.isInteger(id)) {
      return yield* Effect.fail({
        _tag: "MessageControlError" as const,
        error: "Invalid message id.",
        status: 400,
      });
    }
    return id;
  });
}

export function retryOpenCodeDeliveryEffect(
  rawId: string,
): Effect.Effect<MessageControlWithMessage, MessageControlError, MessageControlService> {
  return Effect.gen(function* () {
    const id = yield* requireMessageId(rawId);
    const service = yield* MessageControl;
    const reply = yield* service.getMessage(id);
    if (!reply || reply.author !== "user") {
      return yield* Effect.fail({
        _tag: "MessageControlError" as const,
        error: "Reply message not found.",
        status: 404,
      });
    }

    const parent = reply.parentId === null ? null : yield* service.getMessage(reply.parentId);
    const deliverySessionId = parent?.attachedSessionId || parent?.sessionId;
    const targetSessionId = deliverySessionId || reply.sessionId;
    if (!targetSessionId || !validateSessionId(targetSessionId)) {
      return yield* Effect.fail({
        _tag: "MessageControlError" as const,
        error: "Message is not in an OpenCode-backed session.",
        status: 400,
      });
    }

    const retried = yield* service.retryOpenCodeDeliveryJob(id);
    if (!retried) {
      yield* service.enqueueOpenCodeDeliveryJob({
        messageId: id,
        messageSessionId: reply.sessionId,
        opencodeSessionId: targetSessionId,
        kind: reply.forwardRole === "target" ? "forward_target_message" : "direct_user_message",
        force: true,
      });
    }
    yield* service.broadcast(reply.sessionId);
    const message = yield* service.getMessage(id);
    return { ok: true, message: deserializeMessage(message!) };
  });
}

export function attachMessageSessionEffect(
  rawId: string,
  payload: unknown,
): Effect.Effect<
  MessageControlResult & { sessionId: string | null },
  MessageControlError,
  MessageControlService
> {
  return Effect.gen(function* () {
    const id = yield* requireMessageId(rawId);
    const service = yield* MessageControl;
    const message = yield* service.getMessage(id);
    const rawSessionId =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { sessionId?: unknown }).sessionId === "string"
        ? (payload as { sessionId: string }).sessionId.trim()
        : null;
    const sessionId = rawSessionId || null;

    if (!message || message.author !== "agent" || message.parentId !== null) {
      return yield* Effect.fail({
        _tag: "MessageControlError" as const,
        error: "Agent message not found.",
        status: 404,
      });
    }

    if (!validateSessionId(sessionId)) {
      return yield* Effect.fail({
        _tag: "MessageControlError" as const,
        error: "Session id must look like ses_ followed by letters or numbers.",
        status: 400,
      });
    }

    yield* service.setAttachedSession(id, sessionId);
    yield* service.broadcast();
    return { ok: true, sessionId };
  });
}

export function updateMessageStatusEffect(
  rawId: string,
  payload: unknown,
): Effect.Effect<MessageControlResult, MessageControlError, MessageControlService> {
  return Effect.gen(function* () {
    const id = Number(rawId);
    const status =
      payload && typeof payload === "object" ? (payload as { status?: unknown }).status : undefined;
    const allowed = new Set([
      "queued",
      "speaking",
      "played",
      "done",
      "stopped",
      "received",
      "skipped",
    ]);

    if (!Number.isInteger(id) || !allowed.has(status as string)) {
      return yield* Effect.fail({
        _tag: "MessageControlError" as const,
        error: "Invalid id or status.",
        status: 400,
      });
    }

    const service = yield* MessageControl;
    yield* service.setMessageStatus(id, status as string);
    const sessionId = (yield* service.getMessage(id))?.sessionId || "default";
    yield* service.prunePlayedHistory(sessionId);
    yield* service.broadcast(sessionId);
    return { ok: true };
  });
}

export function deleteMessageEffect(
  rawId: string,
): Effect.Effect<void, MessageControlError, MessageControlService> {
  return Effect.gen(function* () {
    const id = yield* requireMessageId(rawId);
    const service = yield* MessageControl;
    const message = yield* service.getMessage(id);
    if (message?.author === "agent" && message.parentId === null) {
      yield* service.deleteThread(id);
    } else {
      yield* service.deleteMessage(id);
    }
    yield* service.broadcast(message?.sessionId || "default");
  });
}

export function updateMessagePinnedEffect(
  rawId: string,
  payload: MessagePinnedPayload,
): Effect.Effect<
  Schema.Schema.Type<typeof MessagePinnedResult>,
  MessageControlError,
  MessageControlService
> {
  return Effect.gen(function* () {
    const id = Number(rawId);
    const pinned = payload.pinned;
    if (!Number.isInteger(id)) {
      return yield* Effect.fail({
        _tag: "MessageControlError" as const,
        error: "Invalid id or pinned value.",
        status: 400,
      });
    }

    const service = yield* MessageControl;
    const message = yield* service.getMessage(id);
    if (!message) {
      return yield* Effect.fail({
        _tag: "MessageControlError" as const,
        error: "Message not found.",
        status: 404,
      });
    }

    yield* service.setMessagePinned(id, pinned);
    yield* service.prunePlayedHistory(message.sessionId);
    yield* service.broadcast(message.sessionId);
    return { ok: true, pinned };
  });
}

export const MessageControlsGroup = HttpApiGroup.make("message-controls")
  .add(
    HttpApiEndpoint.post("retryOpenCodeDelivery", "/api/messages/:id/retry-opencode")
      .setPath(MessagePath)
      .annotateContext(
        openApiDocs(
          "Retry OpenCode delivery",
          "Forces a re-enqueue of OpenCode delivery for a failed or stuck message.",
        ),
      )
      .addSuccess(MessageControlWithMessage)
      .addError(MessageControlError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("attachMessageSession", "/api/messages/:id/session")
      .setPath(MessagePath)
      .setPayload(MessageControlPayload)
      .annotateContext(
        openApiDocs(
          "Attach message session",
          "Links a message to a target session id used for delivery routing.",
        ),
      )
      .addSuccess(
        Schema.Struct({ ok: Schema.Literal(true), sessionId: Schema.NullOr(Schema.String) }),
      )
      .addError(MessageControlError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("updateMessageStatus", "/api/messages/:id/status")
      .setPath(MessagePath)
      .setPayload(MessageControlPayload)
      .annotateContext(
        openApiDocs(
          "Update message status",
          "Manually sets a message status such as played, skipped, or pending.",
        ),
      )
      .addSuccess(MessageControlResult)
      .addError(MessageControlError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("updateMessagePinned", "/api/messages/:id/pin")
      .setPath(MessagePath)
      .setPayload(MessagePinnedPayload)
      .annotateContext(
        openApiDocs(
          "Pin or unpin a message",
          "Sets whether a message is pinned in the session transcript.",
        ),
      )
      .addSuccess(MessagePinnedResult)
      .addError(MessageControlError, { status: 400 })
      .addError(MessageControlError, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.del("deleteMessage", "/api/messages/:id")
      .setPath(MessagePath)
      .annotateContext(
        openApiDocs(
          "Delete a message",
          "Deletes a message or entire agent thread when the message is a root agent reply.",
        ),
      )
      .addSuccess(MessageDeleted, { status: 204 })
      .addError(MessageControlError, { status: 400 }),
  );

export const MessageControlsApi = HttpApi.make("message-controls").add(MessageControlsGroup);

export function buildMessageControlsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing MessageControlsGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof MessageControlsGroup, E, R>,
    "message-controls",
    (handlers) =>
      handlers
        .handle("retryOpenCodeDelivery", ({ path }) =>
          retryOpenCodeDeliveryEffect(path.id).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("attachMessageSession", ({ path, payload }) =>
          attachMessageSessionEffect(path.id, payload).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("updateMessageStatus", ({ path, payload }) =>
          updateMessageStatusEffect(path.id, payload).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("updateMessagePinned", ({ path, payload }) =>
          updateMessagePinnedEffect(path.id, payload).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("deleteMessage", ({ path }) =>
          deleteMessageEffect(path.id).pipe(
            Effect.matchEffect({
              onFailure: publicRouteErrorResponse,
              onSuccess: () => Effect.succeed(HttpServerResponse.empty({ status: 204 })),
            }),
          ),
        ),
  );
}
