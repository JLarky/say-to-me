import { Deferred, Duration, Effect } from "effect";
import { getOpenCodeActivityPreview, openCodeEventUrl } from "./activity.ts";
import { createActivityHub } from "../activityHub.ts";
import type { ActivityListener } from "../activityHub.ts";
import { createSessionRuntimeRegistry } from "../sessionRuntime.ts";
import { startSseHeartbeat, writeSseEvent } from "../sse/client.ts";
import { createSseWebResponse } from "../sse/stream.ts";
import { opencodeActivityStatusCache } from "./cache.ts";
import { openCodeFetch } from "./http.ts";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

const openCodeActivityHub = createActivityHub({
  fetchSnapshot: (sessionId) => getOpenCodeActivityPreview(sessionId, 8),
  openSignalSource: (sessionId, handlers) => {
    void (async () => {
      try {
        const response = await openCodeFetch(await openCodeEventUrl(sessionId), {
          signal: handlers.signal,
        });
        const reader = response.body?.getReader();
        if (!reader) throw new Error("OpenCode event stream did not return a body.");

        const decoder = new TextDecoder();
        let buffered = "";
        while (!handlers.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffered += decoder.decode(chunk.value, { stream: true });
          let boundary = buffered.indexOf("\n\n");
          while (boundary !== -1) {
            const rawSseEvent = buffered.slice(0, boundary).trim();
            buffered = buffered.slice(boundary + 2);
            const dataLine = rawSseEvent
              .split(/\n+/)
              .find((line) => line.startsWith("data:"))
              ?.replace(/^data:\s*/, "");
            if (dataLine) {
              try {
                const parsed = safeJsonParse(UnknownJson, dataLine);
                const eventSessionId =
                  parsed &&
                  typeof parsed === "object" &&
                  "properties" in parsed &&
                  parsed.properties &&
                  typeof parsed.properties === "object"
                    ? (parsed.properties as { sessionID?: unknown }).sessionID
                    : undefined;
                if (typeof eventSessionId !== "string" || eventSessionId === sessionId) {
                  handlers.onSignal();
                }
              } catch (error) {
                handlers.onError(error instanceof Error ? error : new Error(String(error)));
              }
            }
            boundary = buffered.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (!handlers.signal.aborted) {
          handlers.onError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    })();
  },
});

export const sessionRuntimeRegistry = createSessionRuntimeRegistry();

const workingActivityStatuses = new Set(["busy", "awaiting-input", "pending", "retrying"]);

export function inspectOpenCodeActivityRuntime(sessionId: string) {
  return sessionRuntimeRegistry.inspect(sessionId);
}

export async function getOpenCodeActivitySnapshot(sessionId: string) {
  const snapshot = await openCodeActivityHub.snapshot(sessionId);
  sessionRuntimeRegistry.updateActivitySnapshot(sessionId, snapshot);
  if (typeof snapshot.status === "string") {
    opencodeActivityStatusCache.set(sessionId, { status: snapshot.status, time: Date.now() });
  }
  return snapshot;
}

export function waitForOpenCodeWorkingActivity(
  sessionId: string,
  deliveryStartedAt: number,
  timeoutMs: number,
): Promise<boolean> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const confirmed = yield* Deferred.make<boolean>();

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          const sessionRuntime = sessionRuntimeRegistry.attach(sessionId);
          let settled = false;
          const finish = (isWorking: boolean) => {
            if (settled) return;
            settled = true;
            Effect.runFork(Deferred.succeed(confirmed, isWorking));
          };
          const unsubscribe = openCodeActivityHub.subscribe(sessionId, {
            onSnapshot: (snapshot) => {
              sessionRuntime.updateActivitySnapshot(snapshot);
              const checkedAt = (snapshot.freshness as { checkedAt?: unknown } | undefined)
                ?.checkedAt;
              if (
                typeof snapshot.status === "string" &&
                workingActivityStatuses.has(snapshot.status) &&
                typeof checkedAt === "number" &&
                checkedAt >= deliveryStartedAt
              ) {
                finish(true);
              }
            },
            onError: () => {},
          });

          return () => {
            settled = true;
            unsubscribe();
            sessionRuntime.detach();
          };
        }),
        () =>
          Deferred.await(confirmed).pipe(
            Effect.timeoutTo({
              duration: Duration.millis(timeoutMs),
              onSuccess: (isWorking) => isWorking,
              onTimeout: () => false,
            }),
          ),
        (cleanup) => Effect.sync(cleanup),
      );
    }),
  );
}

export function createOpenCodeActivityEventsResponse(sessionId: string): Response {
  return createSseWebResponse(
    (client) => {
      const stopHeartbeat = startSseHeartbeat(client);
      const sessionRuntime = sessionRuntimeRegistry.attach(sessionId);
      const listener: ActivityListener = {
        onSnapshot: (snapshot) => {
          sessionRuntime.updateActivitySnapshot(snapshot);
          writeSseEvent(client, snapshot, "snapshot");
        },
        onError: (message) =>
          writeSseEvent(
            client,
            { type: "error", message, checkedAt: Date.now() },
            "activity-error",
          ),
      };
      const unsubscribe = openCodeActivityHub.subscribe(sessionId, listener);
      void openCodeActivityHub.snapshot(sessionId).then(listener.onSnapshot, (caught: unknown) => {
        const message = caught instanceof Error ? caught.message : String(caught);
        listener.onError(message);
      });

      return () => {
        stopHeartbeat();
        unsubscribe();
        sessionRuntime.detach();
        client.close?.();
      };
    },
    { kind: "opencode-activity" },
  );
}
