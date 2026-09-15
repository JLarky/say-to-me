import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Layer, Schema } from "effect";
import { createHeardSpecterApp, type HeardQueryResult } from "../specter/heard.ts";
import { normalizeSessionId } from "../session-id.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const HeardSessionPath = Schema.Struct({
  sessionId: Schema.String.annotations({ description: "Session identifier." }),
});

const RecordHeardPayload = Schema.Struct({
  messageId: Schema.NonEmptyString.annotations({
    description: "Queue message id that was spoken and heard.",
  }),
});

const HeardReceiptPayload = Schema.Struct({
  messageId: Schema.String,
  heardAt: Schema.String,
});

const HeardList = Schema.Struct({
  receipts: Schema.Array(HeardReceiptPayload),
});

const HeardRouteError = Schema.Struct({
  _tag: Schema.Literal("HeardRouteError"),
  error: Schema.String,
  status: Schema.Number,
});

type HeardList = Schema.Schema.Type<typeof HeardList>;
type HeardRouteError = Schema.Schema.Type<typeof HeardRouteError>;

export type HeardService = {
  record: (
    sessionId: string,
    messageId: string,
  ) => Effect.Effect<HeardQueryResult, HeardRouteError>;
  list: (sessionId: string) => Effect.Effect<HeardQueryResult, HeardRouteError>;
};

export const Heard = Context.GenericTag<HeardService>("say-to-me/Heard");

function specterFailure(cause: unknown): HeardRouteError {
  return {
    _tag: "HeardRouteError",
    error: cause instanceof Error ? cause.message : "Heard command failed.",
    status: 400,
  };
}

const heardApp = createHeardSpecterApp();

export const HeardLive = Layer.succeed(Heard, {
  record: (sessionId, messageId) =>
    Effect.tryPromise({
      try: async () => {
        await heardApp.recordHeard({ sessionId, messageId });
        return heardApp.heardQuery({ sessionId });
      },
      catch: specterFailure,
    }),
  list: (sessionId) =>
    Effect.tryPromise({
      try: () => heardApp.heardQuery({ sessionId }),
      catch: specterFailure,
    }),
} satisfies HeardService);

function requireSessionId(rawSessionId: string): Effect.Effect<string, HeardRouteError> {
  return Effect.gen(function* () {
    const sessionId = normalizeSessionId(rawSessionId);
    if (!sessionId) {
      return yield* Effect.fail({
        _tag: "HeardRouteError" as const,
        error: "Invalid session id.",
        status: 400,
      });
    }
    return sessionId;
  });
}

export function recordHeardEffect(
  rawSessionId: string,
  payload: Schema.Schema.Type<typeof RecordHeardPayload>,
): Effect.Effect<HeardList, HeardRouteError, HeardService> {
  return Effect.gen(function* () {
    const sessionId = yield* requireSessionId(rawSessionId);
    return yield* Effect.flatMap(Heard, (heard) => heard.record(sessionId, payload.messageId));
  });
}

export function listHeardEffect(
  rawSessionId: string,
): Effect.Effect<HeardList, HeardRouteError, HeardService> {
  return Effect.gen(function* () {
    const sessionId = yield* requireSessionId(rawSessionId);
    return yield* Effect.flatMap(Heard, (heard) => heard.list(sessionId));
  });
}

export const HeardGroup = HttpApiGroup.make("heard")
  .add(
    HttpApiEndpoint.get("listHeard", "/api/sessions/:sessionId/heard")
      .setPath(HeardSessionPath)
      .annotateContext(
        openApiDocs(
          "List heard receipts",
          "Returns Specter-backed receipts for messages this operator has already heard on the session.",
        ),
      )
      .addSuccess(HeardList)
      .addError(HeardRouteError, { status: 400 }),
  )
  .add(
    HttpApiEndpoint.post("recordHeard", "/api/sessions/:sessionId/heard")
      .setPath(HeardSessionPath)
      .setPayload(RecordHeardPayload)
      .annotateContext(
        openApiDocs(
          "Record a heard receipt",
          "Runs the Specter recordHeard command, then heardQuery. Used after TTS so a message is not spoken twice.",
        ),
      )
      .addSuccess(HeardList, { status: 201 })
      .addError(HeardRouteError, { status: 400 }),
  );

export const HeardApi = HttpApi.make("heard").add(HeardGroup);

export function buildHeardHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof HeardGroup, E, R>,
    "heard",
    (handlers) =>
      handlers
        .handle("listHeard", ({ path }) =>
          listHeardEffect(path.sessionId).pipe(Effect.catchAll(publicRouteErrorResponse)),
        )
        .handle("recordHeard", ({ path, payload }) =>
          recordHeardEffect(path.sessionId, payload).pipe(
            Effect.catchAll(publicRouteErrorResponse),
          ),
        ),
  );
}
