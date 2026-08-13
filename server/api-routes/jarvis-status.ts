import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { queuePayload } from "../broadcast.ts";
import {
  buildJarvisStatusEffect,
  type JarvisStatusOpenCodeService,
  parseExtended,
  parseLimit,
  parseSince,
  parseStatusWait,
  waitForIdleStatusEffect,
} from "../jarvis-status.ts";
import { deserializeMessage, getMessage } from "../messages.ts";
import { getSession } from "../sessions.ts";
import { normalizeSessionId } from "../session-id.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";
import { parseJson, UnknownJson } from "@say-to-me/runtime-validation";

const JarvisStatusPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const JarvisMessagePath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
  messageId: Schema.String.annotations({ description: "Message id within the session." }),
});

const JarvisMessageStatusPath = Schema.Struct({
  messageId: Schema.String.annotations({ description: "Message id to resolve Jarvis status for." }),
});

const JarvisStatusQuery = Schema.Struct({
  since: Schema.optional(
    Schema.String.annotations({
      description: "Unix ms cursor; only messages after this timestamp are returned.",
    }),
  ),
  extended: Schema.optional(
    Schema.String.annotations({
      description: 'Pass "1" to include extended activity and waiting-state details.',
    }),
  ),
  limit: Schema.optional(
    Schema.String.annotations({
      description: "Maximum number of messages to include in the status payload.",
    }),
  ),
  wait: Schema.optional(
    Schema.String.annotations({
      description: "Optional long-poll wait in ms until the session is idle or timeout.",
    }),
  ),
});

const JarvisStatusPayload = Schema.Struct({
  sessionId: Schema.String,
  nextPullCursor: Schema.NullOr(Schema.String),
  opencodeState: Schema.NullOr(Schema.String),
  opencodeActivity: Schema.Unknown,
  messages: Schema.Array(Schema.Unknown),
  otherMessages: Schema.optional(Schema.Array(Schema.Number)),
  waitingState: Schema.Unknown,
  wait: Schema.Struct({
    requestedMs: Schema.Number,
    waitedMs: Schema.Number,
    timedOut: Schema.Boolean,
  }),
  params: Schema.Struct({
    since: Schema.NullOr(Schema.Number),
    limit: Schema.Number,
    extended: Schema.Boolean,
    wait: Schema.Number,
    anchorMessageId: Schema.optional(Schema.Number),
  }),
});

const JarvisMessagePayload = Schema.Struct({
  message: Schema.Unknown,
});

const JarvisStatusError = Schema.Struct({
  _tag: Schema.Literal("JarvisStatusError"),
  error: Schema.String,
  status: Schema.Number,
});

type JarvisStatusPayload = Schema.Schema.Type<typeof JarvisStatusPayload>;
type JarvisMessagePayload = Schema.Schema.Type<typeof JarvisMessagePayload>;
type JarvisStatusError = Schema.Schema.Type<typeof JarvisStatusError>;

export function isJarvisStatusPath(pathname: string): boolean {
  return (
    /^\/api\/sessions\/[^/]+\/jarvis-status$/.test(pathname) ||
    /^\/api\/sessions\/[^/]+\/messages\/[^/]+$/.test(pathname) ||
    /^\/api\/messages\/[^/]+\/jarvis-status$/.test(pathname)
  );
}

export async function prettyJsonWebResponse(response: Response): Promise<Response> {
  const text = await response.text();
  const headers = new Headers(response.headers);
  // Re-serializing changes the body length, so the copied Content-Length would
  // be stale and truncate the response mid-JSON. Drop it and let the runtime
  // recompute from the new body.
  headers.delete("content-length");
  const contentType = headers.get("content-type") ?? "";
  if (!contentType.includes("application/json") || !text) {
    return new Response(text, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(`${JSON.stringify(parseJson(UnknownJson, text), null, 2)}\n`, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function requireSessionIdEffect(rawSessionId: string): Effect.Effect<string, JarvisStatusError> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid session id.",
        status: 400,
      });
    }
    return sessionId;
  });
}

export function getJarvisStatusEffect({
  rawSessionId,
  rawSince,
  rawExtended,
  rawLimit,
  rawWait,
}: {
  rawSessionId: string;
  rawSince: string | undefined;
  rawExtended: string | undefined;
  rawLimit: string | undefined;
  rawWait: string | undefined;
}): Effect.Effect<JarvisStatusPayload, JarvisStatusError, JarvisStatusOpenCodeService> {
  return Effect.gen(function* () {
    const sessionId = yield* requireSessionIdEffect(rawSessionId);
    const since = parseSince(rawSince);
    if (!since.ok) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid since message id.",
        status: 400,
      });
    }
    const limit = parseLimit(rawLimit);
    if (!limit.ok) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid limit.",
        status: 400,
      });
    }
    const extended = parseExtended(rawExtended);
    if (!extended.ok) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid extended flag.",
        status: 400,
      });
    }
    const wait = parseStatusWait(rawWait);
    if (!wait.ok) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid wait timeout. Maximum wait is 300000 ms (5 minutes).",
        status: 400,
      });
    }

    if (!getSession(sessionId)) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Session not found.",
        status: 404,
      });
    }

    const waitResult = yield* waitForIdleStatusEffect(sessionId, wait.waitMs);
    const payload = yield* Effect.promise(() => queuePayload(sessionId));
    return yield* buildJarvisStatusEffect({
      sessionId,
      messages: payload.messages,
      wait: waitResult,
      since: since.since,
      extended: extended.extended,
      limit: limit.limit,
      waitMs: wait.waitMs,
    });
  });
}

export function getJarvisStatusByMessageEffect({
  rawMessageId,
  rawSince,
  rawExtended,
  rawLimit,
  rawWait,
}: {
  rawMessageId: string;
  rawSince: string | undefined;
  rawExtended: string | undefined;
  rawLimit: string | undefined;
  rawWait: string | undefined;
}): Effect.Effect<JarvisStatusPayload, JarvisStatusError, JarvisStatusOpenCodeService> {
  return Effect.gen(function* () {
    const messageId = Number(rawMessageId);
    if (!Number.isInteger(messageId)) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid message id.",
        status: 400,
      });
    }
    const anchorMessage = getMessage(messageId);
    if (!anchorMessage) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Message not found.",
        status: 404,
      });
    }

    const since = parseSince(rawSince);
    if (!since.ok) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid since message id.",
        status: 400,
      });
    }
    const limit = parseLimit(rawLimit);
    if (!limit.ok) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid limit.",
        status: 400,
      });
    }
    const extended = parseExtended(rawExtended);
    if (!extended.ok) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid extended flag.",
        status: 400,
      });
    }
    const wait = parseStatusWait(rawWait);
    if (!wait.ok) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid wait timeout. Maximum wait is 300000 ms (5 minutes).",
        status: 400,
      });
    }

    const sessionId = anchorMessage.sessionId;
    const waitResult = yield* waitForIdleStatusEffect(sessionId, wait.waitMs);
    const payload = yield* Effect.promise(() => queuePayload(sessionId));
    return yield* buildJarvisStatusEffect({
      sessionId,
      messages: payload.messages,
      wait: waitResult,
      since: since.since,
      extended: extended.extended,
      limit: limit.limit,
      waitMs: wait.waitMs,
      anchorMessageId: since.since == null ? messageId : null,
    });
  });
}

export function getJarvisMessageEffect({
  rawSessionId,
  rawMessageId,
}: {
  rawSessionId: string;
  rawMessageId: string;
}): Effect.Effect<JarvisMessagePayload, JarvisStatusError> {
  return Effect.gen(function* () {
    const sessionId = yield* requireSessionIdEffect(rawSessionId);
    const messageId = Number(rawMessageId);
    if (!Number.isInteger(messageId)) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Invalid message id.",
        status: 400,
      });
    }
    const message = getMessage(messageId);
    if (!message || message.sessionId !== sessionId) {
      return yield* Effect.fail({
        _tag: "JarvisStatusError" as const,
        error: "Message not found.",
        status: 404,
      });
    }
    return { message: deserializeMessage(message) };
  });
}

export const JarvisStatusGroup = HttpApiGroup.make("jarvis-status")
  .add(
    HttpApiEndpoint.get("getJarvisStatusByMessage", "/api/messages/:messageId/jarvis-status")
      .setPath(JarvisMessageStatusPath)
      .setUrlParams(JarvisStatusQuery)
      .annotateContext(
        openApiDocs(
          "Jarvis status by message",
          "Resolves the session from a message id and returns Jarvis status, messages, and waiting state.",
        ),
      )
      .addSuccess(JarvisStatusPayload)
      .addError(JarvisStatusError, { status: 400 })
      .addError(JarvisStatusError, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.get("getJarvisStatus", "/api/sessions/:sessionId/jarvis-status")
      .setPath(JarvisStatusPath)
      .setUrlParams(JarvisStatusQuery)
      .annotateContext(
        openApiDocs(
          "Get Jarvis session status",
          "Returns OpenCode activity, recent messages, and waiting state for a Jarvis session.",
        ),
      )
      .addSuccess(JarvisStatusPayload)
      .addError(JarvisStatusError, { status: 400 })
      .addError(JarvisStatusError, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.get("getJarvisMessage", "/api/sessions/:sessionId/messages/:messageId")
      .setPath(JarvisMessagePath)
      .annotateContext(
        openApiDocs(
          "Get single Jarvis message",
          "Fetches one message by id when it belongs to the given session.",
        ),
      )
      .addSuccess(JarvisMessagePayload)
      .addError(JarvisStatusError, { status: 400 })
      .addError(JarvisStatusError, { status: 404 }),
  );

export const JarvisStatusApi = HttpApi.make("jarvis-status").add(JarvisStatusGroup);

export function buildJarvisStatusHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof JarvisStatusGroup, E, R>,
    "jarvis-status",
    (handlers) =>
      handlers
        .handle("getJarvisStatus", ({ path, urlParams }) =>
          getJarvisStatusEffect({
            rawSessionId: path.sessionId,
            rawSince: urlParams.since,
            rawExtended: urlParams.extended,
            rawLimit: urlParams.limit,
            rawWait: urlParams.wait,
          }).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("getJarvisStatusByMessage", ({ path, urlParams }) =>
          getJarvisStatusByMessageEffect({
            rawMessageId: path.messageId,
            rawSince: urlParams.since,
            rawExtended: urlParams.extended,
            rawLimit: urlParams.limit,
            rawWait: urlParams.wait,
          }).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("getJarvisMessage", ({ path }) =>
          getJarvisMessageEffect({
            rawSessionId: path.sessionId,
            rawMessageId: path.messageId,
          }).pipe(Effect.catchAll(publicRouteErrorResponse)),
        ),
  );
}
