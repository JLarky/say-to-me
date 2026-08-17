import * as HttpApi from "@effect/platform/HttpApi";
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- Request bodies are untrusted JSON and are validated field-by-field by the route's existing command builders. */
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { type as arktype, type Type } from "arktype";
import { Context, Effect, Layer, Schema } from "effect";
import {
  createMessageResult,
  type CreateMessageInput,
  type CreateMessageResult,
} from "../create-message.ts";
import {
  deserializeMessage,
  getMessage,
  getMessageByClientId,
  prunePlayedHistory,
  updateOpencodeDelivery,
} from "../messages.ts";
import { insertMarkdownAttachmentForMessage, redactInlineAudioAttachmentPaths } from "../images.ts";
import { buildSessionMessageCommand } from "../message-command.ts";
import { detectSessionBackend } from "../session-id.ts";
import { enqueueDelivery } from "../session-services/session-router.ts";
import type { DeliveryEnqueueInput } from "../session-services/interfaces.ts";
import { ensureSession, getSession } from "../sessions.ts";
import { replyBodyKeys, sayBodyKeys } from "../validation.ts";
import { maxMessageLength, maxUserMessageLength, minMessageLength } from "../config.ts";
import { broadcastQueue } from "../broadcast.ts";
import {
  createForwardRelayWithOptionalIdleWait,
  type CreateForwardRelayInput,
} from "../forward-relay-idle.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const MessageCreatePayload = Schema.Unknown;
const SessionMessagePath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});
const MessagePath = Schema.Struct({
  id: Schema.String,
});
const MessageCreateSuccess = Schema.Unknown;

/** Internal Effect failure — status drives HTTP; not the public JSON body. */
type MessageCreateError = {
  _tag: "MessageCreateError";
  error: string;
  status: number;
};

/** Public error body — matches `publicRouteErrorResponse` (`{ error }` only). */
const PublicMessageCreateError = Schema.Struct({
  error: Schema.String,
});

export type MessageCreateService = {
  createMessage: (
    input: CreateMessageInput,
  ) => Effect.Effect<CreateMessageResult, MessageCreateError>;
  ensureSession: (sessionId: string) => Effect.Effect<void>;
  requireSession: (sessionId: string) => Effect.Effect<void, MessageCreateError>;
  createForwardRelay: (
    input: CreateForwardRelayInput,
  ) => Effect.Effect<ReturnType<typeof createForwardRelayWithOptionalIdleWait>>;
  getMessageByClientId: (
    sessionId: string,
    author: "agent" | "user",
    clientMessageId: string,
  ) => Effect.Effect<ReturnType<typeof getMessage>>;
  insertMarkdownAttachment: (messageId: number, content: string) => Effect.Effect<void>;
  updateOpencodeDelivery: (
    messageId: number,
    status: string,
    error: string | null,
    opencodeMessageId: string | null,
  ) => Effect.Effect<void>;
  enqueueDelivery: (
    sessionId: string,
    input: DeliveryEnqueueInput,
  ) => Effect.Effect<void, MessageCreateError>;
  prunePlayedHistory: (sessionId: string) => Effect.Effect<void>;
  broadcast: (sessionId: string) => Effect.Effect<void>;
  getMessage: (id: number) => Effect.Effect<ReturnType<typeof getMessage>>;
};

export const MessageCreate = Context.GenericTag<MessageCreateService>("say-to-me/MessageCreate");

export const MessageCreateLive = Layer.succeed(MessageCreate, {
  createMessage: (input) =>
    Effect.tryPromise({
      try: () => createMessageResult(input),
      catch: (cause) => {
        console.error("[message-create] createMessage failed:", cause);
        return routeError("Unable to create message", 500);
      },
    }),
  ensureSession: (sessionId) =>
    Effect.sync(() => {
      ensureSession(sessionId);
    }),
  requireSession: (sessionId) =>
    sessionId === "default"
      ? Effect.sync(() => {
          ensureSession(sessionId);
        })
      : Effect.gen(function* () {
          const session = getSession(sessionId);
          if (!session) {
            return yield* Effect.fail({
              _tag: "MessageCreateError" as const,
              error: "Session not found.",
              status: 404,
            });
          }
        }),
  createForwardRelay: (input) => Effect.sync(() => createForwardRelayWithOptionalIdleWait(input)),
  getMessageByClientId: (sessionId, author, clientMessageId) =>
    Effect.sync(() => getMessageByClientId(sessionId, author, clientMessageId)),
  insertMarkdownAttachment: (messageId, content) =>
    Effect.sync(() => insertMarkdownAttachmentForMessage(messageId, content)),
  updateOpencodeDelivery: (messageId, status, error, opencodeMessageId) =>
    Effect.sync(() => updateOpencodeDelivery(messageId, status, error, opencodeMessageId)),
  enqueueDelivery: (sessionId, input) =>
    enqueueDelivery(sessionId, input).pipe(
      Effect.mapError((error) => routeError(error.message, 500)),
    ),
  prunePlayedHistory: (sessionId) => Effect.sync(() => prunePlayedHistory(sessionId)),
  broadcast: (sessionId) => Effect.sync(() => broadcastQueue(sessionId)),
  getMessage: (id) => Effect.sync(() => getMessage(id)),
} satisfies MessageCreateService);

function routeError(error: string, status = 400): MessageCreateError {
  return { _tag: "MessageCreateError", error, status };
}

function httpResult(result: CreateMessageResult) {
  return HttpServerResponse.unsafeJson(result.body, { status: result.status });
}

function textValidationError(text: string, maxLength = maxMessageLength()): string | null {
  const minLength = minMessageLength();
  if (text.length < minLength) {
    return `Message is too short. Minimum length is ${minLength} character${minLength === 1 ? "" : "s"}.`;
  }
  if (text.length > maxLength) {
    return `Message is too long. Maximum length is ${maxLength} characters.`;
  }
  return null;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function unknownKeyError(body: unknown, schema: Type): string | null {
  const result = schema(body ?? {});
  return result instanceof arktype.errors ? result.summary : null;
}

function unsupportedFieldError(
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
  body: unknown,
  fields: Array<{ key: string; message: string }>,
): string | null {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  return fields.find(({ key }) => record[key] != null)?.message ?? null;
}

export function createSessionMessageEffect(
  rawSessionId: string,
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
  body: unknown,
): Effect.Effect<HttpServerResponse.HttpServerResponse, MessageCreateError, MessageCreateService> {
  return Effect.gen(function* () {
    const command = yield* buildSessionMessageCommand({ body, rawSessionId }).pipe(
      Effect.mapError((error) => routeError(error.error, error.status)),
    );
    const service = yield* MessageCreate;

    if (command.type === "forward") {
      const {
        clientMessageId,
        extraMarkdown,
        leadingRelay,
        links,
        notifyOnCompletion,
        sessionId,
        targetSessionId,
        text,
        useCli,
      } = command;
      yield* service.ensureSession(sessionId);
      yield* service.ensureSession(targetSessionId);
      const forwardedText = redactInlineAudioAttachmentPaths(text);
      const linksJson = links ? JSON.stringify(links) : null;

      if (clientMessageId) {
        const existingSource = yield* service.getMessageByClientId(
          sessionId,
          "user",
          clientMessageId,
        );
        if (existingSource?.forwardRole === "source") {
          const existingTarget =
            existingSource.forwardTargetMessageId != null
              ? yield* service.getMessage(existingSource.forwardTargetMessageId)
              : null;
          if (!existingTarget) {
            return yield* Effect.fail(
              routeError("Forwarded message already exists but its target is unavailable.", 409),
            );
          }
          let responseSource = existingSource;
          let responseTarget = existingTarget;
          if (["t3", "paseo", "paseo-chat"].includes(detectSessionBackend(targetSessionId))) {
            yield* service.enqueueDelivery(targetSessionId, {
              messageId: existingTarget.id,
              messageSessionId: targetSessionId,
              kind: "forward_target_message",
            });
            responseSource = (yield* service.getMessage(existingSource.id)) ?? existingSource;
            responseTarget = (yield* service.getMessage(existingTarget.id)) ?? existingTarget;
          }
          return HttpServerResponse.unsafeJson(
            {
              message: deserializeMessage(responseSource),
              targetMessage: deserializeMessage(responseTarget),
            },
            { status: 200 },
          );
        }
      }

      const sanitizedForwarded = forwardedText.replace(/[<>]/g, "").trim();
      const receivedPrefix = `${targetSessionId} received message: ${sanitizedForwarded}`;
      // Promise an idle notify only when createForwardRelay actually arms/rebinds a wait.
      const { sourceMessage, targetMessage } = yield* service.createForwardRelay({
        sessionId,
        targetSessionId,
        sourceText: `<say-to-me-system>${receivedPrefix}.</say-to-me-system>`,
        armedSourceText: `<say-to-me-system>${receivedPrefix}. You will be notified once the session is idle.</say-to-me-system>`,
        targetText: forwardedText,
        links: linksJson,
        sourceSessionRefs: JSON.stringify([
          {
            id: targetSessionId,
            // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- The stored session reference must omit alias when the resolved target has no non-empty alias.
            ...(leadingRelay?.session.alias ? { alias: leadingRelay.session.alias } : {}),
          },
        ]),
        targetSessionRefs: JSON.stringify([{ id: sessionId }]),
        clientMessageId,
        notifyOnCompletion,
      });
      if (extraMarkdown) yield* service.insertMarkdownAttachment(targetMessage.id, extraMarkdown);
      const targetBackend = detectSessionBackend(targetSessionId);
      if (targetBackend === "opencode") {
        yield* service.updateOpencodeDelivery(targetMessage.id, "queued", null, null);
      }
      if (targetBackend !== "voice" && targetBackend !== "none") {
        yield* service.enqueueDelivery(targetSessionId, {
          messageId: targetMessage.id,
          messageSessionId: targetSessionId,
          kind: "forward_target_message",
          useCli,
          forceOpencode: command.forceOpencode,
        });
      } else {
        // voice / none: explicit no-op — never fall through to OpenCode delivery.
      }
      yield* service.prunePlayedHistory(sessionId);
      yield* service.prunePlayedHistory(targetSessionId);
      yield* service.broadcast(sessionId);
      yield* service.broadcast(targetSessionId);
      return HttpServerResponse.unsafeJson(
        {
          message: deserializeMessage((yield* service.getMessage(sourceMessage.id))!),
          targetMessage: deserializeMessage((yield* service.getMessage(targetMessage.id))!),
        },
        { status: 201 },
      );
    }

    yield* service.requireSession(command.sessionId);

    const result = yield* service.createMessage({
      sessionId: command.sessionId,
      text: command.text,
      extraMarkdown: command.extraMarkdown,
      pushNotificationText: command.pushNotificationText,
      author: command.author,
      links: command.links,
      sessionRefs: command.sessionRefs,
      clientMessageId: command.clientMessageId,
      useCli: command.useCli,
      forceOpencode: command.forceOpencode,
      overflow: command.overflow,
      images: command.images,
      extractInlineImages: true,
      notifyOnCompletion: command.notifyOnCompletion,
    });
    return httpResult(result);
  });
}

export function sayEffect(
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
  body: unknown,
): Effect.Effect<HttpServerResponse.HttpServerResponse, MessageCreateError, MessageCreateService> {
  return Effect.gen(function* () {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const unsupported = unsupportedFieldError(body, [
      {
        key: "sessionId",
        message:
          "The /say endpoint only posts to the default session and does not accept a sessionId. Post to /api/sessions/<sessionId>/messages instead.",
      },
      {
        key: "links",
        message:
          "The /say endpoint does not accept links. Post to /api/sessions/<sessionId>/messages instead.",
      },
      {
        key: "sessions",
        message:
          "The /say endpoint does not accept sessions. Post to /api/sessions/<sessionId>/messages instead.",
      },
      { key: "images", message: "The /say endpoint does not accept images." },
    ]);
    if (unsupported) return yield* Effect.fail(routeError(unsupported));
    const unknown = unknownKeyError(body, sayBodyKeys);
    if (unknown) return yield* Effect.fail(routeError(unknown));
    const textError = textValidationError(text);
    if (textError) return yield* Effect.fail(routeError(textError));
    const service = yield* MessageCreate;
    const overflow = record.overflow === "force" ? ("force" as const) : null;
    return httpResult(
      yield* service.createMessage({
        sessionId: "default",
        text,
        author: "agent",
        links: null,
        sessionRefs: null,
        clientMessageId: null,
        overflow,
        extractInlineImages: false,
      }),
    );
  });
}

export function replyEffect(
  rawId: string,
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
  body: unknown,
): Effect.Effect<HttpServerResponse.HttpServerResponse, MessageCreateError, MessageCreateService> {
  return Effect.gen(function* () {
    const id = Number(rawId);
    const service = yield* MessageCreate;
    const parent = Number.isInteger(id) ? yield* service.getMessage(id) : null;
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!parent || parent.author !== "agent" || parent.parentId !== null) {
      return yield* Effect.fail(routeError("Agent message not found.", 404));
    }
    const unsupported = unsupportedFieldError(body, [
      { key: "links", message: "Replies do not accept links." },
      { key: "sessions", message: "Replies do not accept sessions." },
      { key: "images", message: "Replies do not accept images." },
    ]);
    if (unsupported) return yield* Effect.fail(routeError(unsupported));
    const unknown = unknownKeyError(body, replyBodyKeys);
    if (unknown) return yield* Effect.fail(routeError(unknown));
    const textError = textValidationError(text, maxUserMessageLength());
    if (textError) return yield* Effect.fail(routeError(textError));
    return httpResult(
      yield* service.createMessage({
        sessionId: parent.sessionId,
        text,
        author: "user",
        links: null,
        sessionRefs: null,
        clientMessageId: null,
        parentId: id,
        deliverySessionId: parent.attachedSessionId || parent.sessionId,
        extractInlineImages: false,
      }),
    );
  });
}

export const MessageCreateGroup = HttpApiGroup.make("message-create")
  .add(
    HttpApiEndpoint.post("createSessionMessage", "/api/sessions/:sessionId/messages")
      .setPath(SessionMessagePath)
      .setPayload(MessageCreatePayload)
      .annotateContext(
        openApiDocs(
          "Create session message",
          "Enqueues a new user or agent message on the given session and starts delivery when needed.",
        ),
      )
      .addSuccess(MessageCreateSuccess, { status: 201 })
      .addError(PublicMessageCreateError, { status: 400 })
      .addError(PublicMessageCreateError, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.post("say", "/say")
      .setPayload(MessageCreatePayload)
      .annotateContext(
        openApiDocs(
          "Say to default queue",
          "Convenience endpoint that creates a message on the default session for TTS playback.",
        ),
      )
      .addSuccess(MessageCreateSuccess, { status: 201 })
      .addError(PublicMessageCreateError, { status: 400 })
      .addError(PublicMessageCreateError, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.post("reply", "/api/messages/:id/replies")
      .setPath(MessagePath)
      .setPayload(MessageCreatePayload)
      .annotateContext(
        openApiDocs(
          "Reply to a message",
          "Creates a reply under an existing parent message, inheriting its session delivery target.",
        ),
      )
      .addSuccess(MessageCreateSuccess, { status: 201 })
      .addError(PublicMessageCreateError, { status: 400 })
      .addError(PublicMessageCreateError, { status: 500 }),
  );

export const MessageCreateApi = HttpApi.make("message-create").add(MessageCreateGroup);

export function buildMessageCreateHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing MessageCreateGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof MessageCreateGroup, E, R>,
    "message-create",
    (handlers) =>
      handlers
        .handle("createSessionMessage", ({ path, payload }) =>
          createSessionMessageEffect(path.sessionId, payload).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        )
        .handle("say", ({ payload }) =>
          sayEffect(payload).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("reply", ({ path, payload }) =>
          replyEffect(path.id, payload).pipe(Effect.catchAll(publicRouteErrorResponse)),
        ),
  );
}
