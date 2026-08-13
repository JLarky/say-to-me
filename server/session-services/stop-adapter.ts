import { Effect } from "effect";
import type { SessionStopperService } from "./interfaces.ts";

export type ExternalCliStopAdapter = {
  stopSession: (
    sessionId: string,
  ) => Promise<{ ok: true } | { ok: false; status: number; error: string }>;
};

export function createSessionStopperAdapter(
  stopAdapter: ExternalCliStopAdapter,
): SessionStopperService {
  return {
    stop: (sessionId) =>
      Effect.tryPromise({
        try: () => stopAdapter.stopSession(sessionId),
        catch: (error) => ({
          _tag: "StopError" as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      }),
  };
}
