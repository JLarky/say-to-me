import { Context, Effect, Layer } from "effect";
import {
  classifyWaitingState,
  type WaitingStateClassifyInput,
} from "@say-to-me/session-utils/waiting-state-classify";
import type { OpenCodeStatus, WaitingStatePayload } from "../src/types.ts";
import { listMessages } from "./messages.ts";
import { getOpenCodeStatus } from "./opencode/client.ts";
import { getCachedOpenCodeActivityStatus } from "./opencode/cache.ts";
import { classifyWithJinx, isJinxEnabled } from "./opencode/jinx.ts";

const recentMessageWindow = 10;

export type WaitingStateMessage = WaitingStateClassifyInput["messages"][number];

export type WaitingStateInput = WaitingStateClassifyInput & {
  opencodeStatus: OpenCodeStatus | null;
};

export type WaitingStateOpenCodeService = {
  getStatus: (sessionId: string) => Effect.Effect<OpenCodeStatus | null>;
};

export const WaitingStateOpenCode = Context.GenericTag<WaitingStateOpenCodeService>(
  "say-to-me/WaitingStateOpenCode",
);

export const WaitingStateOpenCodeLive = Layer.succeed(WaitingStateOpenCode, {
  getStatus: (sessionId) =>
    Effect.tryPromise(() => getOpenCodeStatus(sessionId)).pipe(
      Effect.orElseSucceed((): OpenCodeStatus | null => null),
    ),
} satisfies WaitingStateOpenCodeService);

export { classifyWaitingState };

const jinxCache = new Map<string, { key: string; payload: WaitingStatePayload }>();
const jinxInFlight = new Set<string>();

function refineWithJinx(
  sessionId: string,
  input: WaitingStateInput,
  heuristic: WaitingStatePayload,
  cacheKey: string,
): WaitingStatePayload {
  const refinable = heuristic.state === "can_continue" || heuristic.state === "needs_answer";
  if (!isJinxEnabled() || !refinable) return heuristic;

  const cached = jinxCache.get(sessionId);
  if (cached?.key === cacheKey) return cached.payload;

  const flightKey = `${sessionId}\n${cacheKey}`;
  if (!jinxInFlight.has(flightKey)) {
    jinxInFlight.add(flightKey);
    void classifyWithJinx(input)
      .then((refined) => {
        if (refined) jinxCache.set(sessionId, { key: cacheKey, payload: refined });
      })
      .finally(() => jinxInFlight.delete(flightKey));
  }
  return heuristic;
}

export function getWaitingStateEffect(
  sessionId: string,
): Effect.Effect<WaitingStatePayload, never, WaitingStateOpenCodeService> {
  const program = Effect.all(
    {
      opencodeStatus: Effect.flatMap(WaitingStateOpenCode, (openCode) =>
        openCode.getStatus(sessionId),
      ),
      recent: Effect.try(() => listMessages(sessionId).slice(-recentMessageWindow)),
    },
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(({ opencodeStatus, recent }) => {
      const activityStatus = getCachedOpenCodeActivityStatus(sessionId);
      const input: WaitingStateInput = {
        opencodeStatus,
        activityStatus,
        messages: recent.map(({ author, text, opencodeDeliveryStatus }) => ({
          author,
          text,
          opencodeDeliveryStatus,
        })),
      };
      const heuristic: WaitingStatePayload = {
        ...classifyWaitingState(input),
        source: "heuristic",
      };
      const latest = recent.at(-1);
      const cacheKey = latest
        ? `${latest.id}:${latest.status}:${latest.opencodeDeliveryStatus ?? ""}:${opencodeStatus ?? ""}:${activityStatus ?? ""}`
        : "";
      return refineWithJinx(sessionId, input, heuristic, cacheKey);
    }),
    Effect.orElseSucceed((): WaitingStatePayload => ({
      state: "unknown",
      reason: "Could not gather session context.",
    })),
  );
  return program;
}

export function getWaitingState(sessionId: string): Promise<WaitingStatePayload> {
  return Effect.runPromise(
    getWaitingStateEffect(sessionId).pipe(Effect.provide(WaitingStateOpenCodeLive)),
  );
}
