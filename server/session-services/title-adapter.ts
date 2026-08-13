import { Effect } from "effect";
import type { SessionTitleService } from "./interfaces.ts";

/**
 * Bridge for providers that expose a simple sync reader.
 * The returned service still returns Effect so callers stay in Effect.
 */
export type ExternalCliTitleReader = {
  getTitle: (sessionId: string) => string | null;
};

export function createSessionTitleAdapter(reader: ExternalCliTitleReader): SessionTitleService {
  return {
    getTitle: (sessionId) => Effect.sync(() => reader.getTitle(sessionId)),
  };
}
