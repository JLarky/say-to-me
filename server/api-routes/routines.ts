import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Cause, Effect, Option, Schema } from "effect";
import { normalizeSessionId } from "../session-id.ts";
import {
  kickRoutineWorker,
  RoutineClock,
  RoutineRepository,
  serializeRoutine,
  isScheduleRoutine,
  isSessionIdleRoutine,
  type CreateRoutineInput,
  type RoutineStatus,
  type UpdateRoutineInput,
} from "../routines.ts";
import { disarmSessionIdleWatch } from "../session-idle-disarm.ts";
import { stopForwardCompletionNotificationWatch } from "../notifications.ts";
import { openApiDocs } from "./openapi-docs.ts";

export type RoutineError = {
  error: string;
  status: number;
};

function routineError(error: string, status = 400): RoutineError {
  return { error, status };
}

function textField(value: unknown, field: string, maxLength: number): string | RoutineError {
  if (typeof value !== "string") return routineError(`${field} is required.`);
  const trimmed = value.trim();
  if (!trimmed) return routineError(`${field} is required.`);
  if (trimmed.length > maxLength)
    return routineError(`${field} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

function optionalTextField(
  value: unknown,
  field: string,
  maxLength: number,
): string | RoutineError | undefined {
  if (value === undefined) return undefined;
  return textField(value, field, maxLength);
}

function timestampField(value: unknown, field: string): number | RoutineError {
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (typeof numberValue !== "number" || !Number.isFinite(numberValue) || numberValue <= 0) {
    return routineError(`${field} must be a positive timestamp in milliseconds.`);
  }
  return Math.floor(numberValue);
}

function optionalTimestampField(value: unknown, field: string): number | RoutineError | undefined {
  if (value === undefined) return undefined;
  return timestampField(value, field);
}

function intervalField(value: unknown): number | null | RoutineError {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (typeof numberValue !== "number" || !Number.isFinite(numberValue) || numberValue < 60_000) {
    return routineError(
      "Repeat interval must be at least 60000 ms, or null for a one-shot routine.",
    );
  }
  return Math.floor(numberValue);
}

function optionalIntervalField(value: unknown): number | null | RoutineError | undefined {
  if (value === undefined) return undefined;
  return intervalField(value);
}

function isRoutineError(value: unknown): value is RoutineError {
  return Boolean(value && typeof value === "object" && "error" in value && "status" in value);
}

function publicRoutineError(error: unknown, fallback: string): RoutineError {
  return isRoutineError(error) ? error : routineError(fallback, 500);
}

export function publicRoutineErrorFromCause(
  cause: Cause.Cause<unknown>,
  fallback: string,
): RoutineError {
  return publicRoutineError(Option.getOrUndefined(Cause.failureOption(cause)), fallback);
}

function parseCreate(body: Record<string, unknown>): CreateRoutineInput | RoutineError {
  const ownerSessionId = normalizeSessionId(
    typeof body.ownerSessionId === "string" ? body.ownerSessionId : null,
  );
  if (!ownerSessionId) return routineError("Invalid owner session id.");

  const triggerRaw = body.trigger;
  if (!triggerRaw || typeof triggerRaw !== "object" || Array.isArray(triggerRaw)) {
    return routineError("trigger is required.");
  }
  const triggerBody = triggerRaw as Record<string, unknown>;
  if (triggerBody.kind !== "schedule") {
    return routineError('Phase 1 only supports trigger.kind "schedule".');
  }
  const dueAt = timestampField(triggerBody.dueAt, "trigger.dueAt");
  if (isRoutineError(dueAt)) return dueAt;
  const intervalMs = intervalField(triggerBody.intervalMs);
  if (isRoutineError(intervalMs)) return intervalMs;

  const actionRaw = body.action;
  if (!actionRaw || typeof actionRaw !== "object" || Array.isArray(actionRaw)) {
    return routineError("action is required.");
  }
  const actionBody = actionRaw as Record<string, unknown>;
  if (actionBody.kind !== "deliver_prompt") {
    return routineError('Phase 1 only supports action.kind "deliver_prompt".');
  }
  const actionTitle = textField(actionBody.title, "action.title", 80);
  if (isRoutineError(actionTitle)) return actionTitle;
  const message = textField(actionBody.message, "action.message", 1000);
  if (isRoutineError(message)) return message;

  const title =
    body.title === undefined || body.title === null
      ? actionTitle
      : textField(body.title, "Title", 80);
  if (isRoutineError(title)) return title;

  return {
    ownerSessionId,
    title,
    trigger: { kind: "schedule", dueAt, intervalMs },
    action: { kind: "deliver_prompt", title: actionTitle, message },
  };
}

function parseUpdate(body: Record<string, unknown>): UpdateRoutineInput | RoutineError {
  const input: UpdateRoutineInput = {};
  if (body.ownerSessionId !== undefined) {
    const ownerSessionId = normalizeSessionId(
      typeof body.ownerSessionId === "string" ? body.ownerSessionId : null,
    );
    if (!ownerSessionId) return routineError("Invalid owner session id.");
    input.ownerSessionId = ownerSessionId;
  }
  if (body.title !== undefined) {
    if (body.title === null) {
      input.title = null;
    } else {
      const title = optionalTextField(body.title, "Title", 80);
      if (isRoutineError(title)) return title;
      if (title !== undefined) input.title = title;
    }
  }

  if (body.trigger !== undefined) {
    if (!body.trigger || typeof body.trigger !== "object" || Array.isArray(body.trigger)) {
      return routineError("trigger must be an object.");
    }
    const triggerBody = body.trigger as Record<string, unknown>;
    if (triggerBody.kind !== undefined && triggerBody.kind !== "schedule") {
      return routineError('Phase 1 only supports trigger.kind "schedule".');
    }
    const dueAt = optionalTimestampField(triggerBody.dueAt, "trigger.dueAt");
    if (isRoutineError(dueAt)) return dueAt;
    const intervalMs = optionalIntervalField(triggerBody.intervalMs);
    if (isRoutineError(intervalMs)) return intervalMs;
    const trigger: NonNullable<UpdateRoutineInput["trigger"]> = { kind: "schedule" };
    if (dueAt !== undefined) trigger.dueAt = dueAt;
    if (intervalMs !== undefined) trigger.intervalMs = intervalMs;
    input.trigger = trigger;
  }

  if (body.action !== undefined) {
    if (!body.action || typeof body.action !== "object" || Array.isArray(body.action)) {
      return routineError("action must be an object.");
    }
    const actionBody = body.action as Record<string, unknown>;
    if (actionBody.kind !== undefined && actionBody.kind !== "deliver_prompt") {
      return routineError('Phase 1 only supports action.kind "deliver_prompt".');
    }
    const actionTitle = optionalTextField(actionBody.title, "action.title", 80);
    if (isRoutineError(actionTitle)) return actionTitle;
    const message = optionalTextField(actionBody.message, "action.message", 1000);
    if (isRoutineError(message)) return message;
    const action: NonNullable<UpdateRoutineInput["action"]> = { kind: "deliver_prompt" };
    if (actionTitle !== undefined) action.title = actionTitle;
    if (message !== undefined) action.message = message;
    input.action = action;
  }

  return input;
}

function routineId(raw: string | undefined): number | RoutineError {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : routineError("Invalid routine id.");
}

function canEditRoutine(status: RoutineStatus): boolean {
  return status === "active" || status === "paused" || status === "cancelled";
}

function invalidActionMessage(action: string, status: RoutineStatus): string {
  switch (action) {
    case "pause":
      return `Cannot pause a ${status} routine.`;
    case "resume":
      return `Cannot resume a ${status} routine.`;
    case "cancel":
      return `Cannot stop a ${status} routine.`;
    case "trigger":
      return `Cannot trigger a ${status} routine.`;
    default:
      return "Invalid routine action.";
  }
}

export function listRoutinesEffect(sessionId?: string) {
  return Effect.gen(function* () {
    const repository = yield* RoutineRepository;
    const items = yield* repository.list(sessionId);
    return { routines: items.map(serializeRoutine) };
  });
}

export function createRoutineEffect(input: CreateRoutineInput) {
  return Effect.gen(function* () {
    const repository = yield* RoutineRepository;
    const routine = yield* repository.create(input);
    kickRoutineWorker();
    return { routine: serializeRoutine(routine) };
  });
}

export function updateRoutineEffect(id: number, input: UpdateRoutineInput) {
  return Effect.gen(function* () {
    const repository = yield* RoutineRepository;
    const clock = yield* RoutineClock;
    const current = yield* repository.get(id);
    if (!current) return yield* Effect.fail(routineError("Routine not found.", 404));
    if (!isScheduleRoutine(current)) {
      return yield* Effect.fail(routineError("Only schedule routines can be edited.", 409));
    }
    if (!canEditRoutine(current.status)) {
      return yield* Effect.fail(routineError(`Cannot edit a ${current.status} routine.`, 409));
    }
    const updateInput: UpdateRoutineInput & { reactivateCancelled?: boolean } = { ...input };
    if (current.status === "cancelled") {
      const nextFireAt = input.trigger?.dueAt ?? current.trigger.nextFireAt;
      const now = yield* clock.now;
      if (nextFireAt <= now) {
        return yield* Effect.fail(
          routineError("Choose a future next fire time to reactivate this cancelled routine.", 409),
        );
      }
      updateInput.reactivateCancelled = true;
    }
    const routine = yield* repository.update(id, updateInput);
    if (!routine) return yield* Effect.fail(routineError("Unable to update routine.", 409));
    kickRoutineWorker();
    return { routine: serializeRoutine(routine) };
  });
}

function disarmIdleWait(routine: import("../routines.ts").Routine) {
  if (!isSessionIdleRoutine(routine)) return;
  const sourceMessageId = disarmSessionIdleWatch(routine);
  if (sourceMessageId != null) stopForwardCompletionNotificationWatch(sourceMessageId);
}

export function deleteRoutineEffect(id: number) {
  return Effect.gen(function* () {
    const repository = yield* RoutineRepository;
    const current = yield* repository.get(id);
    if (!current) return yield* Effect.fail(routineError("Routine not found.", 404));
    if (isSessionIdleRoutine(current)) {
      const cancellable =
        current.status === "active" || current.status === "paused" || current.status === "firing";
      if (cancellable) {
        // Soft-cancel before disarm so an in-flight tick sees a terminal routine first.
        const cancelled = yield* repository.cancel(id);
        if (!cancelled) return yield* Effect.fail(routineError("Unable to cancel wait.", 409));
        disarmIdleWait(cancelled);
        kickRoutineWorker();
        return { ok: true };
      }
      // Terminal idle waits (fired/failed/cancelled) cannot soft-cancel again; remove the
      // row so the session UI can clear history without a misleading 409.
      if (
        current.status === "fired" ||
        current.status === "failed" ||
        current.status === "cancelled"
      ) {
        const deleted = yield* repository.delete(id);
        if (!deleted) return yield* Effect.fail(routineError("Routine not found.", 404));
        kickRoutineWorker();
        return { ok: true };
      }
      return yield* Effect.fail(routineError("Unable to cancel wait.", 409));
    }
    disarmIdleWait(current);
    const deleted = yield* repository.delete(id);
    if (!deleted) return yield* Effect.fail(routineError("Routine not found.", 404));
    kickRoutineWorker();
    return { ok: true };
  });
}

export function runRoutineActionEffect(id: number, action: string) {
  return Effect.gen(function* () {
    const repository = yield* RoutineRepository;
    const clock = yield* RoutineClock;
    const now = yield* clock.now;
    const current = yield* repository.get(id);
    if (!current) return yield* Effect.fail(routineError("Routine not found.", 404));
    if (action === "resume" && isScheduleRoutine(current) && current.status === "paused") {
      if (current.trigger.nextFireAt <= now) {
        return yield* Effect.fail(
          routineError("This routine is in the past. Edit it before resuming."),
        );
      }
    }
    if (
      (action === "pause" || action === "resume" || action === "trigger") &&
      isSessionIdleRoutine(current)
    ) {
      return yield* Effect.fail(
        routineError(`Cannot ${action} a session_idle wait. Delete it to cancel.`, 409),
      );
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
      return yield* Effect.fail(routineError(invalidActionMessage(action, current.status), 409));
    }
    const routine = yield* (() => {
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
          return Effect.fail(routineError("Invalid routine action."));
      }
    })();
    if (!routine) return yield* Effect.fail(routineError("Unable to update routine.", 409));
    if (action === "cancel") disarmIdleWait(routine);
    kickRoutineWorker();
    return { routine: serializeRoutine(routine) };
  });
}

function routineErrorResponse(error: RoutineError) {
  return HttpServerResponse.unsafeJson({ error: error.error }, { status: error.status });
}

function routineProgramResponse<A, E, R>(program: Effect.Effect<A, E, R>, fallback: string) {
  return program.pipe(
    Effect.catchAllCause((cause) =>
      Effect.succeed(routineErrorResponse(publicRoutineErrorFromCause(cause, fallback))),
    ),
  );
}

const RoutineBody = Schema.Record({ key: Schema.String, value: Schema.Unknown });

const RoutineListQuery = Schema.Struct({
  sessionId: Schema.optional(
    Schema.String.annotations({
      description: "When set, only routines for this session are returned.",
    }),
  ),
});

const RoutineIdPath = Schema.Struct({
  id: Schema.String.annotations({ description: "Routine id." }),
});

const RoutineListed = Schema.Struct({
  routines: Schema.Array(Schema.Unknown),
});

const RoutineMutated = Schema.Struct({
  routine: Schema.Unknown,
});

const RoutineDeleted = Schema.Struct({
  ok: Schema.Boolean,
});

/** Public error body — matches `routineErrorResponse` (`{ error }` only). */
const PublicRoutineError = Schema.Struct({
  error: Schema.String,
});

export const RoutinesGroup = HttpApiGroup.make("routines")
  .add(
    HttpApiEndpoint.get("listRoutines", "/api/routines")
      .setUrlParams(RoutineListQuery)
      .annotateContext(
        openApiDocs("List routines", "Lists routines, optionally filtered by session id."),
      )
      .addSuccess(RoutineListed)
      .addError(PublicRoutineError, { status: 400 })
      .addError(PublicRoutineError, { status: 404 })
      .addError(PublicRoutineError, { status: 409 })
      .addError(PublicRoutineError, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.post("createRoutine", "/api/routines")
      .setPayload(RoutineBody)
      .annotateContext(
        openApiDocs("Create routine", "Creates a new schedule routine from the request body."),
      )
      .addSuccess(RoutineMutated, { status: 201 })
      .addError(PublicRoutineError, { status: 400 })
      .addError(PublicRoutineError, { status: 404 })
      .addError(PublicRoutineError, { status: 409 })
      .addError(PublicRoutineError, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.patch("updateRoutine", "/api/routines/:id")
      .setPath(RoutineIdPath)
      .setPayload(RoutineBody)
      .annotateContext(openApiDocs("Update routine", "Updates fields on an existing routine."))
      .addSuccess(RoutineMutated)
      .addError(PublicRoutineError, { status: 400 })
      .addError(PublicRoutineError, { status: 404 })
      .addError(PublicRoutineError, { status: 409 })
      .addError(PublicRoutineError, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.del("deleteRoutine", "/api/routines/:id")
      .setPath(RoutineIdPath)
      .annotateContext(openApiDocs("Delete routine", "Deletes a routine by id."))
      .addSuccess(RoutineDeleted)
      .addError(PublicRoutineError, { status: 400 })
      .addError(PublicRoutineError, { status: 404 })
      .addError(PublicRoutineError, { status: 409 })
      .addError(PublicRoutineError, { status: 500 }),
  )
  .add(
    HttpApiEndpoint.post("runRoutineAction", "/api/routines/:id/actions")
      .setPath(RoutineIdPath)
      .setPayload(RoutineBody)
      .annotateContext(
        openApiDocs(
          "Run routine action",
          "Applies an action such as pause, resume, cancel, or trigger to a routine.",
        ),
      )
      .addSuccess(RoutineMutated)
      .addError(PublicRoutineError, { status: 400 })
      .addError(PublicRoutineError, { status: 404 })
      .addError(PublicRoutineError, { status: 409 })
      .addError(PublicRoutineError, { status: 500 }),
  );

export const RoutinesApi = HttpApi.make("routines").add(RoutinesGroup);

export function buildRoutinesHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof RoutinesGroup, E, R>,
    "routines",
    (handlers) =>
      handlers
        .handle("listRoutines", ({ urlParams }) => {
          const requestedSessionId = urlParams.sessionId;
          const sessionId = requestedSessionId ? normalizeSessionId(requestedSessionId) : null;
          if (requestedSessionId && !sessionId) {
            return Effect.succeed(routineErrorResponse(routineError("Invalid session id.")));
          }
          return routineProgramResponse(
            listRoutinesEffect(sessionId ?? undefined),
            "Unable to list routines.",
          );
        })
        .handle("createRoutine", ({ payload }) => {
          const input = parseCreate({ ...payload });
          if (isRoutineError(input)) return Effect.succeed(routineErrorResponse(input));
          return routineProgramResponse(createRoutineEffect(input), "Unable to create routine.");
        })
        .handle("updateRoutine", ({ path, payload }) => {
          const id = routineId(path.id);
          if (isRoutineError(id)) return Effect.succeed(routineErrorResponse(id));
          const input = parseUpdate({ ...payload });
          if (isRoutineError(input)) return Effect.succeed(routineErrorResponse(input));
          return routineProgramResponse(
            updateRoutineEffect(id, input),
            "Unable to update routine.",
          );
        })
        .handle("deleteRoutine", ({ path }) => {
          const id = routineId(path.id);
          if (isRoutineError(id)) return Effect.succeed(routineErrorResponse(id));
          return routineProgramResponse(deleteRoutineEffect(id), "Unable to delete routine.");
        })
        .handle("runRoutineAction", ({ path, payload }) => {
          const id = routineId(path.id);
          if (isRoutineError(id)) return Effect.succeed(routineErrorResponse(id));
          const action = typeof payload.action === "string" ? payload.action : "";
          return routineProgramResponse(
            runRoutineActionEffect(id, action),
            "Unable to run routine action.",
          );
        }),
  );
}
