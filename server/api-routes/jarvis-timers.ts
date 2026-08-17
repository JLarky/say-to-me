import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Cause, Effect, Option, Schema } from "effect";
import { normalizeSessionId } from "../session-id.ts";
import {
  JarvisTimerClock,
  JarvisTimerRepository,
  kickJarvisTimerWorker,
  serializeJarvisTimer,
  type CreateJarvisTimerInput,
  type TimerStatus,
  type UpdateJarvisTimerInput,
} from "../timers.ts";
import { openApiDocs } from "./openapi-docs.ts";

export type TimerError = {
  error: string;
  status: number;
};

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Route JSON is parsed one field at a time so invalid values receive the existing field-specific errors.
type TimerRequestBody = Record<string, unknown>;

function timerError(error: string, status = 400): TimerError {
  return { error, status };
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function textField(value: unknown, field: string, maxLength: number): string | TimerError {
  if (typeof value !== "string") return timerError(`${field} is required.`);
  const trimmed = value.trim();
  if (!trimmed) return timerError(`${field} is required.`);
  if (trimmed.length > maxLength)
    return timerError(`${field} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

function optionalTextField(
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
  value: unknown,
  field: string,
  maxLength: number,
): string | TimerError | undefined {
  if (value === undefined) return undefined;
  return textField(value, field, maxLength);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function timestampField(value: unknown, field: string): number | TimerError {
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (typeof numberValue !== "number" || !Number.isFinite(numberValue) || numberValue <= 0) {
    return timerError(`${field} must be a positive timestamp in milliseconds.`);
  }
  return Math.floor(numberValue);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function optionalTimestampField(value: unknown, field: string): number | TimerError | undefined {
  if (value === undefined) return undefined;
  return timestampField(value, field);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function intervalField(value: unknown): number | null | TimerError {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (typeof numberValue !== "number" || !Number.isFinite(numberValue) || numberValue < 60_000) {
    return timerError("Repeat interval must be at least 60000 ms, or null for a one-shot timer.");
  }
  return Math.floor(numberValue);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function optionalIntervalField(value: unknown): number | null | TimerError | undefined {
  if (value === undefined) return undefined;
  return intervalField(value);
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function isTimerError(value: unknown): value is TimerError {
  return Boolean(value && typeof value === "object" && "error" in value && "status" in value);
}

function publicTimerError(cause: unknown, fallback: string): TimerError {
  return isTimerError(cause) ? cause : timerError(fallback, 500);
}

export function publicTimerErrorFromCause(
  cause: Cause.Cause<unknown>,
  fallback: string,
): TimerError {
  return publicTimerError(Option.getOrUndefined(Cause.failureOption(cause)), fallback);
}

function parseCreate(body: TimerRequestBody): CreateJarvisTimerInput | TimerError {
  const sessionId = normalizeSessionId(typeof body.sessionId === "string" ? body.sessionId : null);
  if (!sessionId) return timerError("Invalid target session id.");
  const title = textField(body.title, "Title", 80);
  if (isTimerError(title)) return title;
  const message = textField(body.message, "Message", 1000);
  if (isTimerError(message)) return message;
  const dueAt = timestampField(body.dueAt, "Next fire time");
  if (isTimerError(dueAt)) return dueAt;
  const intervalMs = intervalField(body.intervalMs);
  if (isTimerError(intervalMs)) return intervalMs;
  return { sessionId, title, message, dueAt, intervalMs };
}

function parseUpdate(body: TimerRequestBody): UpdateJarvisTimerInput | TimerError {
  const input: UpdateJarvisTimerInput = {};
  if (body.sessionId !== undefined) {
    const sessionId = normalizeSessionId(
      typeof body.sessionId === "string" ? body.sessionId : null,
    );
    if (!sessionId) return timerError("Invalid target session id.");
    input.sessionId = sessionId;
  }
  const title = optionalTextField(body.title, "Title", 80);
  if (isTimerError(title)) return title;
  if (title !== undefined) input.title = title;
  const message = optionalTextField(body.message, "Message", 1000);
  if (isTimerError(message)) return message;
  if (message !== undefined) input.message = message;
  const dueAt = optionalTimestampField(body.dueAt, "Next fire time");
  if (isTimerError(dueAt)) return dueAt;
  if (dueAt !== undefined) input.dueAt = dueAt;
  const intervalMs = optionalIntervalField(body.intervalMs);
  if (isTimerError(intervalMs)) return intervalMs;
  if (intervalMs !== undefined) input.intervalMs = intervalMs;
  return input;
}

function timerId(raw: string | undefined): number | TimerError {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : timerError("Invalid timer id.");
}

function canEditTimer(status: TimerStatus): boolean {
  return status === "active" || status === "paused" || status === "cancelled";
}

function invalidActionMessage(action: string, status: TimerStatus): string {
  switch (action) {
    case "pause":
      return `Cannot pause a ${status} timer.`;
    case "resume":
      return `Cannot resume a ${status} timer.`;
    case "cancel":
      return `Cannot stop a ${status} timer.`;
    case "trigger":
      return `Cannot trigger a ${status} timer.`;
    default:
      return "Invalid timer action.";
  }
}

export function listJarvisTimersEffect(sessionId?: string) {
  return Effect.gen(function* () {
    const repository = yield* JarvisTimerRepository;
    const timers = yield* repository.list(sessionId);
    return { timers: timers.map(serializeJarvisTimer) };
  });
}

export function createJarvisTimerEffect(input: CreateJarvisTimerInput) {
  return Effect.gen(function* () {
    const repository = yield* JarvisTimerRepository;
    const timer = yield* repository.create(input);
    kickJarvisTimerWorker();
    return { timer: serializeJarvisTimer(timer) };
  });
}

export function updateJarvisTimerEffect(id: number, input: UpdateJarvisTimerInput) {
  return Effect.gen(function* () {
    const repository = yield* JarvisTimerRepository;
    const clock = yield* JarvisTimerClock;
    const current = yield* repository.get(id);
    if (!current) return yield* Effect.fail(timerError("Timer not found.", 404));
    if (!canEditTimer(current.status)) {
      return yield* Effect.fail(timerError(`Cannot edit a ${current.status} timer.`, 409));
    }
    const updateInput: UpdateJarvisTimerInput & { reactivateCancelled?: boolean } = { ...input };
    if (current.status === "cancelled") {
      const nextFireAt = input.dueAt ?? current.nextFireAt;
      const now = yield* clock.now;
      if (nextFireAt <= now) {
        return yield* Effect.fail(
          timerError("Choose a future next fire time to reactivate this cancelled timer.", 409),
        );
      }
      updateInput.reactivateCancelled = true;
    }
    const timer = yield* repository.update(id, updateInput);
    if (!timer) return yield* Effect.fail(timerError("Unable to update timer.", 409));
    kickJarvisTimerWorker();
    return { timer: serializeJarvisTimer(timer) };
  });
}

export function deleteJarvisTimerEffect(id: number) {
  return Effect.gen(function* () {
    const repository = yield* JarvisTimerRepository;
    const deleted = yield* repository.delete(id);
    if (!deleted) return yield* Effect.fail(timerError("Timer not found.", 404));
    kickJarvisTimerWorker();
    return { ok: true };
  });
}

export function runJarvisTimerActionEffect(id: number, action: string) {
  return Effect.gen(function* () {
    const repository = yield* JarvisTimerRepository;
    const clock = yield* JarvisTimerClock;
    const now = yield* clock.now;
    const current = yield* repository.get(id);
    if (!current) return yield* Effect.fail(timerError("Timer not found.", 404));
    if (action === "resume" && current.status === "paused" && current.nextFireAt <= now) {
      return yield* Effect.fail(timerError("This timer is in the past. Edit it before resuming."));
    }
    const validAction =
      (action === "pause" && (current.status === "active" || current.status === "firing")) ||
      (action === "resume" && current.status === "paused") ||
      (action === "cancel" &&
        (current.status === "active" ||
          current.status === "paused" ||
          current.status === "firing")) ||
      (action === "trigger" && current.status === "active");
    if (!validAction) {
      return yield* Effect.fail(timerError(invalidActionMessage(action, current.status), 409));
    }
    const timer = yield* (() => {
      switch (action) {
        case "pause":
          return repository.pause(id);
        case "resume":
          return repository.resume(id, now);
        case "cancel":
          return repository.cancel(id);
        case "trigger":
          return repository.trigger(id, now);
        default:
          return Effect.fail(timerError("Invalid timer action."));
      }
    })();
    if (!timer) return yield* Effect.fail(timerError("Unable to update timer.", 409));
    kickJarvisTimerWorker();
    return { timer: serializeJarvisTimer(timer) };
  });
}

function timerErrorResponse(error: TimerError) {
  return HttpServerResponse.unsafeJson({ error: error.error }, { status: error.status });
}

function timerProgramResponse<A, E, R>(program: Effect.Effect<A, E, R>, fallback: string) {
  return program.pipe(
    Effect.catchAllCause((cause) =>
      Effect.succeed(timerErrorResponse(publicTimerErrorFromCause(cause, fallback))),
    ),
  );
}

// Request bodies are validated with the hand-written parsers above (which carry
// the exact public error messages and statuses), so the HttpApi payload schema
// is intentionally a loose record rather than a strict shape.
const JarvisTimerBody = Schema.Record({ key: Schema.String, value: Schema.Unknown });

const JarvisTimerListQuery = Schema.Struct({
  sessionId: Schema.optional(
    Schema.String.annotations({
      description: "When set, only timers for this session are returned.",
    }),
  ),
});

const JarvisTimerIdPath = Schema.Struct({
  id: Schema.String.annotations({ description: "Jarvis timer id." }),
});

const JarvisTimerListed = Schema.Struct({
  timers: Schema.Array(Schema.Unknown),
});

const JarvisTimerMutated = Schema.Struct({
  timer: Schema.Unknown,
});

const JarvisTimerDeleted = Schema.Struct({
  ok: Schema.Boolean,
});

export const JarvisTimersGroup = HttpApiGroup.make("jarvis-timers")
  .add(
    HttpApiEndpoint.get("listJarvisTimers", "/api/jarvis-timers")
      .setUrlParams(JarvisTimerListQuery)
      .annotateContext(
        openApiDocs(
          "List Jarvis timers",
          "Lists scheduled Jarvis timers, optionally filtered by session id.",
        ),
      )
      .addSuccess(JarvisTimerListed),
  )
  .add(
    HttpApiEndpoint.post("createJarvisTimer", "/api/jarvis-timers")
      .setPayload(JarvisTimerBody)
      .annotateContext(
        openApiDocs(
          "Create Jarvis timer",
          "Creates a new scheduled Jarvis timer from the request body.",
        ),
      )
      .addSuccess(JarvisTimerMutated, { status: 201 }),
  )
  .add(
    HttpApiEndpoint.patch("updateJarvisTimer", "/api/jarvis-timers/:id")
      .setPath(JarvisTimerIdPath)
      .setPayload(JarvisTimerBody)
      .annotateContext(
        openApiDocs(
          "Update Jarvis timer",
          "Updates fields on an existing Jarvis timer identified by id.",
        ),
      )
      .addSuccess(JarvisTimerMutated),
  )
  .add(
    HttpApiEndpoint.del("deleteJarvisTimer", "/api/jarvis-timers/:id")
      .setPath(JarvisTimerIdPath)
      .annotateContext(
        openApiDocs(
          "Delete Jarvis timer",
          "Deletes a Jarvis timer by id and returns a success flag.",
        ),
      )
      .addSuccess(JarvisTimerDeleted),
  )
  .add(
    HttpApiEndpoint.post("runJarvisTimerAction", "/api/jarvis-timers/:id/actions")
      .setPath(JarvisTimerIdPath)
      .setPayload(JarvisTimerBody)
      .annotateContext(
        openApiDocs(
          "Run Jarvis timer action",
          "Applies an action such as pause, resume, or fire-now to a Jarvis timer.",
        ),
      )
      .addSuccess(JarvisTimerMutated),
  );

export const JarvisTimersApi = HttpApi.make("jarvis-timers").add(JarvisTimersGroup);

export function buildJarvisTimersHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing JarvisTimersGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof JarvisTimersGroup, E, R>,
    "jarvis-timers",
    (handlers) =>
      handlers
        .handle("listJarvisTimers", ({ urlParams }) => {
          const requestedSessionId = urlParams.sessionId;
          const sessionId = requestedSessionId ? normalizeSessionId(requestedSessionId) : null;
          if (requestedSessionId && !sessionId) {
            return Effect.succeed(timerErrorResponse(timerError("Invalid session id.")));
          }
          return timerProgramResponse(
            listJarvisTimersEffect(sessionId ?? undefined),
            "Unable to list timers.",
          );
        })
        .handle("createJarvisTimer", ({ payload }) => {
          const input = parseCreate({ ...payload });
          if (isTimerError(input)) return Effect.succeed(timerErrorResponse(input));
          return timerProgramResponse(createJarvisTimerEffect(input), "Unable to create timer.");
        })
        .handle("updateJarvisTimer", ({ path, payload }) => {
          const id = timerId(path.id);
          if (isTimerError(id)) return Effect.succeed(timerErrorResponse(id));
          const input = parseUpdate({ ...payload });
          if (isTimerError(input)) return Effect.succeed(timerErrorResponse(input));
          return timerProgramResponse(
            updateJarvisTimerEffect(id, input),
            "Unable to update timer.",
          );
        })
        .handle("deleteJarvisTimer", ({ path }) => {
          const id = timerId(path.id);
          if (isTimerError(id)) return Effect.succeed(timerErrorResponse(id));
          return timerProgramResponse(deleteJarvisTimerEffect(id), "Unable to delete timer.");
        })
        .handle("runJarvisTimerAction", ({ path, payload }) => {
          const id = timerId(path.id);
          if (isTimerError(id)) return Effect.succeed(timerErrorResponse(id));
          const action = typeof payload.action === "string" ? payload.action : "";
          return timerProgramResponse(
            runJarvisTimerActionEffect(id, action),
            "Unable to run timer action.",
          );
        }),
  );
}
