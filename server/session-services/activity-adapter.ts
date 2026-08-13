import { Effect } from "effect";
import type { ActivityListener, ActivitySnapshot } from "../activityHub.ts";
import type { SessionActivityService } from "./interfaces.ts";

export type ExternalCliActivityHubAdapter = {
  getSnapshot: (sessionId: string, limit?: number) => Promise<ActivitySnapshot>;
  subscribe: (
    sessionId: string,
    limit: number,
    listener: ActivityListener<ActivitySnapshot>,
  ) => () => void;
};

export function createSessionActivityAdapter(
  hub: ExternalCliActivityHubAdapter,
): SessionActivityService {
  return {
    getSnapshot: (sessionId, limit) =>
      Effect.tryPromise({
        try: () => hub.getSnapshot(sessionId, limit),
        catch: (error) => ({
          _tag: "ActivityError" as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      }),
    subscribe: (sessionId, limit, listener) => hub.subscribe(sessionId, limit, listener),
  };
}
