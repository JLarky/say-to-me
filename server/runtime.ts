import { Context, Effect, Layer, Scope } from "effect";
import { resumeClaudeDeliveryWorkers } from "./claude/durable-delivery.ts";
import { resumeCodexDeliveryWorkers } from "./codex/durable-delivery.ts";
import { resumeCursorDeliveryWorkers } from "./cursor/durable-delivery.ts";
import { drizzleSqlite } from "./db/index.ts";
import { disposeSayToMeHttpApiHandler } from "./api-routes/effect-api.ts";
import { resumeGrokDeliveryWorkers } from "./grok/durable-delivery.ts";
import {
  clearForwardCompletionNotificationWatches,
  resumeNotificationWatches,
} from "./notifications.ts";
import { resumeCompletionWatches, stopAllCompletionWatches } from "./opencode/completion-watch.ts";
import {
  OpenCodeDeliveryRuntime,
  type OpenCodeDeliveryRuntimeService,
} from "./opencode/durable-delivery.ts";
import { startRoutineWorker, stopRoutineWorker } from "./routines.ts";
import { resumeT3DeliveryWorkers, stopT3DeliveryWorker } from "./t3/durable-delivery.ts";
import { resumePaseoDeliveryWorkers, stopPaseoDeliveryWorker } from "./paseo/durable-delivery.ts";
import { resumePaseoChatListeners, stopAllPaseoChatListeners } from "./paseo/chat-listener.ts";

export type ServerRuntimeService = {
  start: Effect.Effect<void>;
  stop: Effect.Effect<void>;
};

export const ServerRuntime = Context.GenericTag<ServerRuntimeService>("say-to-me/ServerRuntime");

function disposeHttpApiHandlers() {
  return Effect.promise(() => disposeSayToMeHttpApiHandler().then(() => undefined));
}

export function startServerRuntimeEffect(
  deliveryRuntime: OpenCodeDeliveryRuntimeService,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* deliveryRuntime.start;
    yield* Effect.sync(() => {
      startRoutineWorker();
      resumeCompletionWatches();
      resumeNotificationWatches();
      resumeClaudeDeliveryWorkers();
      resumeCodexDeliveryWorkers();
      resumeCursorDeliveryWorkers();
      resumeGrokDeliveryWorkers();
      resumeT3DeliveryWorkers();
      resumePaseoDeliveryWorkers();
      resumePaseoChatListeners();
    });
  });
}

export function stopServerRuntimeEffect(
  deliveryRuntime: OpenCodeDeliveryRuntimeService,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* Effect.sync(() => {
      stopAllCompletionWatches();
      stopAllPaseoChatListeners();
      clearForwardCompletionNotificationWatches();
    });
    yield* Effect.promise(() => stopRoutineWorker());
    yield* Effect.promise(() => stopT3DeliveryWorker());
    yield* Effect.promise(() => stopPaseoDeliveryWorker());
    yield* deliveryRuntime.stop;
    // Under Vitest with isolate:false the Effect web handler is module-scoped and
    // must stay alive for later files in the same worker.
    if (process.env.VITEST !== "true") {
      yield* disposeHttpApiHandlers();
    }
    // SQLite close is also skipped under Vitest (see db/index.ts).
    yield* Effect.sync(() => {
      if (process.env.VITEST !== "true") {
        drizzleSqlite.close();
      }
    });
  });
}

export function scopedServerRuntime(
  runtime: ServerRuntimeService,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.acquireRelease(runtime.start, () => runtime.stop);
}

export function scopedServerRuntimeEffect(): Effect.Effect<
  void,
  never,
  ServerRuntimeService | Scope.Scope
> {
  return Effect.gen(function* () {
    const runtime = yield* ServerRuntime;
    yield* scopedServerRuntime(runtime);
  });
}

export const ServerRuntimeLive = Layer.effect(
  ServerRuntime,
  Effect.gen(function* () {
    const deliveryRuntime = yield* OpenCodeDeliveryRuntime;
    return {
      start: startServerRuntimeEffect(deliveryRuntime),
      stop: stopServerRuntimeEffect(deliveryRuntime),
    } satisfies ServerRuntimeService;
  }),
);
