import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { deserializeMessage, getLastUserMessage, listUserMessagesAfter } from "../messages.ts";
import { normalizeSessionId } from "../session-id.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const POLL_INTERVAL_MS = 300;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const SessionPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});
const PollQuery = Schema.Struct({
  since: Schema.optional(
    Schema.String.annotations({
      description: "Return only user messages with id greater than this integer cursor.",
    }),
  ),
  timeout: Schema.optional(
    Schema.String.annotations({
      description:
        "Long-poll wait budget (e.g. 30000, 30sec, 5min). Caps at 300000ms; default 300000ms.",
    }),
  ),
  limit: Schema.optional(
    Schema.String.annotations({
      description: "Maximum messages to return (default 50, max 100).",
    }),
  ),
});
const PollPayload = Schema.Unknown;
const PollError = Schema.Struct({
  _tag: Schema.Literal("UserMessagesPollError"),
  error: Schema.String,
  status: Schema.Number,
});
type PollError = Schema.Schema.Type<typeof PollError>;

function pollError(error: string, status = 400): PollError {
  return { _tag: "UserMessagesPollError", error, status };
}

function parseSince(raw: string | undefined): { ok: true; since: number | null } | { ok: false } {
  if (raw == null) return { ok: true, since: null };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return { ok: false };
  return { ok: true, since: value };
}

function parseTimeout(raw: string | undefined): { ok: true; ms: number } | { ok: false } {
  if (raw == null) return { ok: true, ms: DEFAULT_TIMEOUT_MS };
  const match = raw.match(/^(\d+)(min|sec|ms)?$/);
  if (!match) return { ok: false };
  const value = Number(match[1]);
  const ms = match[2] === "min" ? value * 60_000 : match[2] === "sec" ? value * 1000 : value;
  if (ms > MAX_TIMEOUT_MS) return { ok: false };
  return { ok: true, ms };
}

function parseLimit(raw: string | undefined): { ok: true; limit: number } | { ok: false } {
  if (raw == null) return { ok: true, limit: DEFAULT_LIMIT };
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) return { ok: false };
  return { ok: true, limit: value };
}

export function userMessagesPollEffect({
  rawSessionId,
  rawSince,
  rawTimeout,
  rawLimit,
}: {
  rawSessionId: string;
  rawSince: string | undefined;
  rawTimeout: string | undefined;
  rawLimit: string | undefined;
}): Effect.Effect<unknown, PollError> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) return yield* Effect.fail(pollError("Invalid session id."));
    const since = parseSince(rawSince);
    if (!since.ok) return yield* Effect.fail(pollError("Invalid since message id."));
    const timeout = parseTimeout(rawTimeout);
    if (!timeout.ok) {
      return yield* Effect.fail(pollError(`Invalid timeout. Maximum is ${MAX_TIMEOUT_MS} ms.`));
    }
    const limit = parseLimit(rawLimit);
    if (!limit.ok) return yield* Effect.fail(pollError(`Invalid limit. Maximum is ${MAX_LIMIT}.`));

    // No cursor: hand back the most recent user message immediately.
    if (since.since == null) {
      const last = getLastUserMessage(sessionId);
      return {
        messages: last ? [deserializeMessage(last)] : [],
        hasMore: false,
        timedOut: false,
      };
    }

    // Long-poll for user messages newer than `since`, oldest-first. Fetch one
    // extra to detect whether more than `limit` are already waiting.
    const deadline = Date.now() + timeout.ms;
    while (true) {
      const rows = listUserMessagesAfter(sessionId, since.since, limit.limit + 1);
      if (rows.length > 0) {
        return {
          messages: rows.slice(0, limit.limit).map((row) => deserializeMessage(row)),
          hasMore: rows.length > limit.limit,
          timedOut: false,
        };
      }
      if (Date.now() >= deadline) {
        return { messages: [], hasMore: false, timedOut: true };
      }
      yield* Effect.sleep(`${POLL_INTERVAL_MS} millis`);
    }
  });
}

export const UserMessagesPollGroup = HttpApiGroup.make("user-messages-poll").add(
  HttpApiEndpoint.get("userMessagesPoll", "/api/sessions/:sessionId/user-messages-poll")
    .setPath(SessionPath)
    .setUrlParams(PollQuery)
    .annotateContext(
      openApiDocs(
        "Long-poll user messages",
        "Waits up to timeout for new user messages after the since cursor, then returns them oldest-first.",
      ),
    )
    .addSuccess(PollPayload)
    .addError(PollError, { status: 400 }),
);

export const UserMessagesPollApi = HttpApi.make("user-messages-poll").add(UserMessagesPollGroup);

export function buildUserMessagesPollHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing UserMessagesPollGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof UserMessagesPollGroup, E, R>,
    "user-messages-poll",
    (handlers) =>
      handlers.handle("userMessagesPoll", ({ path, urlParams }) =>
        userMessagesPollEffect({
          rawSessionId: path.sessionId,
          rawSince: urlParams.since,
          rawTimeout: urlParams.timeout,
          rawLimit: urlParams.limit,
        }).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
