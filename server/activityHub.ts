/**
 * Server-side activity hub for agent sessions.
 *
 * The hub owns lifecycle/resource coordination for a single activity read model:
 * many clients watching one session share one observer engine, one canonical
 * snapshot cache, and one fanout channel. Backends provide the observation
 * details through config:
 *
 * - signal-capable providers, such as OpenCode, can attach an upstream event
 *   source that wakes a coalesced refetch.
 * - polling-only providers, such as transcript-backed CLI agents, can omit the
 *   signal source and rely on the shared poll loop.
 *
 * Lifecycle state machine (per session):
 *
 *   COLD --subscribe--> LIVE --last client leaves--> HOT_IDLE
 *     ^                  ^                            |
 *     |                  +---- client returns --------+
 *     |                                               |
 *     |                                  hotIdleMs elapsed
 *     |                                               v
 *     +---- warmGraceMs elapsed <-- WARM_IDLE <-------+
 *                                  (cache only; observer stopped)
 *
 * - LIVE: one observer engine (poll loop, coalescer, optional signal source).
 * - HOT_IDLE: 0 clients but observer kept warm briefly to avoid reconnect churn.
 * - WARM_IDLE: observer stopped; cached snapshot survives for fast reconnects.
 * - COLD: hub removed; no fibers, timers, signal source, or cache.
 */
import { Duration, Effect, Fiber, PubSub, Queue, Ref, Stream } from "effect";

export type ActivityPhase = "COLD" | "LIVE" | "HOT_IDLE" | "WARM_IDLE";

/** A canonical snapshot is whatever the backend adapter returns. */
export type ActivitySnapshot = { status?: string | null } & Record<string, unknown>;

type Broadcast<TSnapshot extends ActivitySnapshot> =
  | { readonly kind: "snapshot"; readonly data: TSnapshot }
  | { readonly kind: "error"; readonly message: string };

export interface ActivitySignalHandlers {
  /** Call when a backend signal should trigger a coalesced canonical refetch. */
  readonly onSignal: () => void;
  /** Call when the signal source errors (not on normal abort). */
  readonly onError: (error: Error) => void;
  /** Aborted by the hub when the observer is no longer needed. */
  readonly signal: AbortSignal;
}

export interface ActivityHubConfig<TSnapshot extends ActivitySnapshot = ActivitySnapshot> {
  /** Canonical snapshot fetch. This is the backend adapter's read-model query. */
  readonly fetchSnapshot: (sessionId: string) => Promise<TSnapshot>;
  /** Optional live signal source. Omit for polling-only providers. */
  readonly openSignalSource?: (sessionId: string, handlers: ActivitySignalHandlers) => void;
  /** Canonical refetch cadence while LIVE or HOT_IDLE. */
  readonly pollIntervalMs?: number;
  /** Debounce window that coalesces signal bursts into one refetch. */
  readonly coalesceMs?: number;
  /** How long the observer stays warm with 0 clients before WARM_IDLE. */
  readonly hotIdleMs?: number;
  /** Total grace from last client leaving before the hub goes COLD. */
  readonly warmGraceMs?: number;
  /** Whether a snapshot represents active work that should keep HOT_IDLE longer. */
  readonly isActiveSnapshot?: (snapshot: TSnapshot) => boolean;
}

export interface ActivityListener<TSnapshot extends ActivitySnapshot = ActivitySnapshot> {
  readonly onSnapshot: (snapshot: TSnapshot) => void;
  readonly onError: (message: string) => void;
}

export interface HubInspection {
  readonly phase: ActivityPhase;
  readonly clients: number;
  readonly engineRunning: boolean;
  readonly idleRunning: boolean;
  readonly hasCachedSnapshot: boolean;
}

interface HubState<TSnapshot extends ActivitySnapshot> {
  phase: ActivityPhase;
  latest: TSnapshot | null;
  lastSnapshotAt: number | null;
}

interface Hub<TSnapshot extends ActivitySnapshot> {
  readonly sessionId: string;
  readonly pubsub: PubSub.PubSub<Broadcast<TSnapshot>>;
  readonly state: Ref.Ref<HubState<TSnapshot>>;
  /** Coalescing inbox: each backend signal offers one token. */
  readonly refetch: Queue.Queue<void>;
  clients: number;
  /** LIVE/HOT_IDLE observer: poll + coalesce + optional signal source. */
  engine: Fiber.RuntimeFiber<void, never> | null;
  /** Grace supervisor: HOT_IDLE -> WARM_IDLE -> COLD, interruptible on return. */
  idle: Fiber.RuntimeFiber<void, never> | null;
}

export interface ActivityHub<TSnapshot extends ActivitySnapshot = ActivitySnapshot> {
  /** Subscribe a client or server waiter. Returns unsubscribe. */
  subscribe(sessionId: string, listener: ActivityListener<TSnapshot>): () => void;
  /** One-off canonical snapshot for non-streaming endpoints; reuses warm cache. */
  snapshot(sessionId: string): Promise<TSnapshot>;
  /** Introspection for tests. */
  inspect(sessionId: string): HubInspection | null;
  /** Tear every hub down. */
  shutdown(): void;
}

const nowMs = () => Date.now();

function defaultIsActiveSnapshot<TSnapshot extends ActivitySnapshot>(snapshot: TSnapshot): boolean {
  return snapshot.status === "busy" || snapshot.status === "pending";
}

export function createActivityHub<TSnapshot extends ActivitySnapshot = ActivitySnapshot>(
  config: ActivityHubConfig<TSnapshot>,
): ActivityHub<TSnapshot> {
  const pollIntervalMs = config.pollIntervalMs ?? 5000;
  const coalesceMs = config.coalesceMs ?? 500;
  const hotIdleMs = config.hotIdleMs ?? 30_000;
  const warmGraceMs = config.warmGraceMs ?? 120_000;
  const isActiveSnapshot = config.isActiveSnapshot ?? defaultIsActiveSnapshot;

  const hubs = new Map<string, Hub<TSnapshot>>();

  const setPhase = (hub: Hub<TSnapshot>, phase: ActivityPhase) =>
    Ref.update(hub.state, (s) => ({ ...s, phase }));

  const publishError = (hub: Hub<TSnapshot>, message: string) =>
    PubSub.publish(hub.pubsub, { kind: "error", message });

  const refetchAndPublish = (hub: Hub<TSnapshot>) =>
    Effect.tryPromise({
      try: () => config.fetchSnapshot(hub.sessionId),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }).pipe(
      Effect.flatMap((snapshot) =>
        Ref.update(hub.state, (s) => ({
          ...s,
          latest: snapshot,
          lastSnapshotAt: nowMs(),
        })).pipe(Effect.zipRight(PubSub.publish(hub.pubsub, { kind: "snapshot", data: snapshot }))),
      ),
      Effect.catchAll((error) => publishError(hub, error.message)),
    );

  const pollLoop = (hub: Hub<TSnapshot>) =>
    Effect.sleep(Duration.millis(pollIntervalMs)).pipe(
      Effect.zipRight(refetchAndPublish(hub)),
      Effect.forever,
    );

  const coalesceWorker = (hub: Hub<TSnapshot>) =>
    Queue.take(hub.refetch).pipe(
      Effect.zipRight(Effect.sleep(Duration.millis(coalesceMs))),
      Effect.zipRight(Queue.takeAll(hub.refetch)),
      Effect.zipRight(refetchAndPublish(hub)),
      Effect.forever,
    );

  const signalSourcePump = (hub: Hub<TSnapshot>) =>
    Effect.async<void>(() => {
      const controller = new AbortController();
      let cancelled = false;
      config.openSignalSource?.(hub.sessionId, {
        onSignal: () => {
          if (!cancelled) Effect.runSync(Queue.offer(hub.refetch, undefined));
        },
        onError: (error) => {
          if (!cancelled) Effect.runFork(publishError(hub, error.message));
        },
        signal: controller.signal,
      });
      return Effect.sync(() => {
        cancelled = true;
        controller.abort();
      });
    });

  const observerEffects = (hub: Hub<TSnapshot>) => {
    if (config.openSignalSource) return [pollLoop(hub), coalesceWorker(hub), signalSourcePump(hub)];
    return [pollLoop(hub), coalesceWorker(hub)];
  };

  const engineProgram = (hub: Hub<TSnapshot>) =>
    refetchAndPublish(hub).pipe(
      Effect.zipRight(
        Effect.all(observerEffects(hub), {
          concurrency: "unbounded",
          discard: true,
        }),
      ),
    );

  const startEngine = (hub: Hub<TSnapshot>) => {
    if (hub.engine) return;
    hub.engine = Effect.runFork(engineProgram(hub));
  };

  const stopEngine = (hub: Hub<TSnapshot>) => {
    if (!hub.engine) return;
    Effect.runFork(Fiber.interrupt(hub.engine));
    hub.engine = null;
  };

  const teardown = (hub: Hub<TSnapshot>) => {
    if (hub.clients > 0) return;
    stopEngine(hub);
    Effect.runSync(setPhase(hub, "COLD"));
    Effect.runFork(PubSub.shutdown(hub.pubsub));
    hubs.delete(hub.sessionId);
  };

  const idleProgram = (hub: Hub<TSnapshot>) =>
    Effect.gen(function* () {
      const { latest } = yield* Ref.get(hub.state);
      const active = latest ? isActiveSnapshot(latest) : false;
      const hotMs = active ? warmGraceMs : Math.min(hotIdleMs, warmGraceMs);
      yield* setPhase(hub, "HOT_IDLE");
      yield* Effect.sleep(Duration.millis(hotMs));
      yield* Effect.sync(() => stopEngine(hub));
      yield* setPhase(hub, "WARM_IDLE");
      yield* Effect.sleep(Duration.millis(Math.max(0, warmGraceMs - hotMs)));
      yield* Effect.sync(() => teardown(hub));
    });

  const startIdle = (hub: Hub<TSnapshot>) => {
    if (hub.idle) return;
    hub.idle = Effect.runFork(
      idleProgram(hub).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            hub.idle = null;
          }),
        ),
      ),
    );
  };

  const cancelIdle = (hub: Hub<TSnapshot>) => {
    if (!hub.idle) return;
    Effect.runFork(Fiber.interrupt(hub.idle));
    hub.idle = null;
  };

  const getOrCreate = (sessionId: string): Hub<TSnapshot> => {
    const existing = hubs.get(sessionId);
    if (existing) return existing;
    const hub: Hub<TSnapshot> = {
      sessionId,
      pubsub: Effect.runSync(PubSub.unbounded<Broadcast<TSnapshot>>()),
      state: Effect.runSync(
        Ref.make<HubState<TSnapshot>>({ phase: "COLD", latest: null, lastSnapshotAt: null }),
      ),
      refetch: Effect.runSync(Queue.unbounded<void>()),
      clients: 0,
      engine: null,
      idle: null,
    };
    hubs.set(sessionId, hub);
    return hub;
  };

  const addClient = (hub: Hub<TSnapshot>) => {
    cancelIdle(hub);
    hub.clients += 1;
    Effect.runSync(setPhase(hub, "LIVE"));
    startEngine(hub);
  };

  const removeClient = (hub: Hub<TSnapshot>) => {
    hub.clients = Math.max(0, hub.clients - 1);
    if (hub.clients === 0) startIdle(hub);
  };

  return {
    subscribe(sessionId, listener) {
      const hub = getOrCreate(sessionId);
      addClient(hub);

      const cached = Effect.runSync(Ref.get(hub.state)).latest;
      if (cached) listener.onSnapshot(cached);

      const fiber = Effect.runFork(
        Stream.fromPubSub(hub.pubsub).pipe(
          Stream.runForEach((broadcast) =>
            Effect.sync(() => {
              if (broadcast.kind === "snapshot") listener.onSnapshot(broadcast.data);
              else listener.onError(broadcast.message);
            }),
          ),
        ),
      );

      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        Effect.runFork(Fiber.interrupt(fiber));
        removeClient(hub);
      };
    },

    async snapshot(sessionId) {
      const hub = hubs.get(sessionId);
      if (hub) {
        const cached = Effect.runSync(Ref.get(hub.state)).latest;
        if (cached) return cached;
      }
      return config.fetchSnapshot(sessionId);
    },

    inspect(sessionId) {
      const hub = hubs.get(sessionId);
      if (!hub) return null;
      const state = Effect.runSync(Ref.get(hub.state));
      return {
        phase: state.phase,
        clients: hub.clients,
        engineRunning: hub.engine !== null,
        idleRunning: hub.idle !== null,
        hasCachedSnapshot: state.latest !== null,
      };
    },

    shutdown() {
      for (const hub of hubs.values()) {
        cancelIdle(hub);
        stopEngine(hub);
        Effect.runFork(PubSub.shutdown(hub.pubsub));
      }
      hubs.clear();
    },
  };
}
