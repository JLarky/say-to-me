import { Effect, Layer, Ref, Clock } from "effect";
import { SessionTitle, type SessionTitleService } from "./interfaces.ts";

/**
 * Creates a SessionTitle Layer that caches results using Effect Ref + Clock.
 * The provided `read` should be the uncached source of truth (best-effort).
 */
export function makeCachedTitleLayer(
  read: (sessionId: string) => Effect.Effect<string | null>,
  ttlMs: number,
): Layer.Layer<SessionTitleService> {
  const live = Effect.gen(function* () {
    const cache = yield* Ref.make(new Map<string, { title: string | null; at: number }>());

    const service: SessionTitleService = {
      getTitle: (sessionId: string) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const c = yield* Ref.get(cache);
          const hit = c.get(sessionId);
          if (hit && now - hit.at < ttlMs) {
            return hit.title;
          }
          const title = yield* read(sessionId);
          yield* Ref.update(cache, (m) => {
            const next = new Map(m);
            next.set(sessionId, { title, at: now });
            return next;
          });
          return title;
        }),
    };

    return service;
  });

  return Layer.effect(SessionTitle, live);
}
