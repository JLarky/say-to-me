import { Duration, Effect, Fiber, Ref } from "effect";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Backend adapters own additional snapshot fields; this registry only reads status.
export type SessionActivitySnapshot = { status?: string | null } & Record<string, unknown>;

export type SessionRuntimePhase = "warm" | "idle_shutdown_pending";

export type SessionRuntimeLogEvent =
  | "create"
  | "attach"
  | "detach"
  | "idle-start"
  | "idle-cancel"
  | "activity"
  | "dispose"
  | "shutdown";

export type SessionRuntimeLogDetail =
  | { readonly runtimeId: number }
  | { readonly attachedClients: number; readonly runtimeId: number }
  | { readonly idleShutdownMs: number; readonly runtimeId: number }
  | { readonly runtimeId: number; readonly status: string | null };

export type SessionRuntimeInspection = {
  sessionId: string;
  runtimeId: number;
  phase: SessionRuntimePhase;
  attachedClients: number;
  attachCount: number;
  detachCount: number;
  idleRunning: boolean;
  latestActivitySnapshot: SessionActivitySnapshot | null;
  latestActivityAt: number | null;
};

type SessionRuntimeState = Omit<SessionRuntimeInspection, "idleRunning">;

type SessionRuntime = {
  readonly sessionId: string;
  readonly runtimeId: number;
  readonly state: Ref.Ref<SessionRuntimeState>;
  idle: Fiber.RuntimeFiber<void, never> | null;
};

export type SessionRuntimeHandle = {
  readonly runtimeId: number;
  detach: () => void;
  updateActivitySnapshot: (snapshot: SessionActivitySnapshot) => void;
};

export type SessionRuntimeRegistry = {
  attach: (sessionId: string) => SessionRuntimeHandle;
  updateActivitySnapshot: (sessionId: string, snapshot: SessionActivitySnapshot) => void;
  inspect: (sessionId: string) => SessionRuntimeInspection | null;
  shutdown: () => void;
};

export function createSessionRuntimeRegistry({
  idleShutdownMs = 5 * 60_000,
  log = (event, sessionId, detail) => {
    console.info("[session-runtime]", event, { sessionId, ...detail });
  },
}: {
  idleShutdownMs?: number;
  log?: (event: SessionRuntimeLogEvent, sessionId: string, detail: SessionRuntimeLogDetail) => void;
} = {}): SessionRuntimeRegistry {
  const runtimes = new Map<string, SessionRuntime>();
  let nextRuntimeId = 1;

  function inspectRuntime(runtime: SessionRuntime): SessionRuntimeInspection {
    return { ...Effect.runSync(Ref.get(runtime.state)), idleRunning: runtime.idle !== null };
  }

  function setPhase(runtime: SessionRuntime, phase: SessionRuntimePhase): void {
    Effect.runSync(Ref.update(runtime.state, (state) => ({ ...state, phase })));
  }

  function dispose(runtime: SessionRuntime): void {
    const state = Effect.runSync(Ref.get(runtime.state));
    if (state.attachedClients > 0) return;
    runtime.idle = null;
    runtimes.delete(runtime.sessionId);
    log("dispose", runtime.sessionId, { runtimeId: runtime.runtimeId });
  }

  function startIdle(runtime: SessionRuntime): void {
    if (runtime.idle) return;
    setPhase(runtime, "idle_shutdown_pending");
    log("idle-start", runtime.sessionId, { idleShutdownMs, runtimeId: runtime.runtimeId });
    runtime.idle = Effect.runFork(
      Effect.sleep(Duration.millis(idleShutdownMs)).pipe(
        Effect.zipRight(Effect.sync(() => dispose(runtime))),
      ),
    );
  }

  function cancelIdle(runtime: SessionRuntime): void {
    if (!runtime.idle) return;
    Effect.runFork(Fiber.interrupt(runtime.idle));
    runtime.idle = null;
    setPhase(runtime, "warm");
    log("idle-cancel", runtime.sessionId, { runtimeId: runtime.runtimeId });
  }

  function getOrCreate(sessionId: string): SessionRuntime {
    const existing = runtimes.get(sessionId);
    if (existing) return existing;
    const runtimeId = nextRuntimeId;
    nextRuntimeId += 1;
    const runtime: SessionRuntime = {
      sessionId,
      runtimeId,
      state: Effect.runSync(
        Ref.make<SessionRuntimeState>({
          sessionId,
          runtimeId,
          phase: "warm",
          attachedClients: 0,
          attachCount: 0,
          detachCount: 0,
          latestActivitySnapshot: null,
          latestActivityAt: null,
        }),
      ),
      idle: null,
    };
    runtimes.set(sessionId, runtime);
    log("create", sessionId, { runtimeId });
    return runtime;
  }

  function updateExistingActivitySnapshot(
    sessionId: string,
    snapshot: SessionActivitySnapshot,
  ): void {
    const runtime = runtimes.get(sessionId);
    if (!runtime) return;
    Effect.runSync(
      Ref.update(runtime.state, (state) => ({
        ...state,
        latestActivityAt: Date.now(),
        latestActivitySnapshot: snapshot,
      })),
    );
    log("activity", sessionId, { runtimeId: runtime.runtimeId, status: snapshot.status ?? null });
  }

  return {
    attach(sessionId) {
      const runtime = getOrCreate(sessionId);
      cancelIdle(runtime);
      Effect.runSync(
        Ref.update(runtime.state, (state) => ({
          ...state,
          attachedClients: state.attachedClients + 1,
          attachCount: state.attachCount + 1,
          phase: "warm" as const,
        })),
      );
      log("attach", sessionId, { runtimeId: runtime.runtimeId });

      let detached = false;
      return {
        runtimeId: runtime.runtimeId,
        detach: () => {
          if (detached) return;
          detached = true;
          const nextClients = Effect.runSync(
            Ref.modify(runtime.state, (state) => {
              const attachedClients = Math.max(0, state.attachedClients - 1);
              return [
                attachedClients,
                { ...state, attachedClients, detachCount: state.detachCount + 1 },
              ];
            }),
          );
          log("detach", sessionId, { attachedClients: nextClients, runtimeId: runtime.runtimeId });
          if (nextClients === 0) startIdle(runtime);
        },
        updateActivitySnapshot: (snapshot) => updateExistingActivitySnapshot(sessionId, snapshot),
      };
    },
    updateActivitySnapshot: updateExistingActivitySnapshot,
    inspect(sessionId) {
      const runtime = runtimes.get(sessionId);
      return runtime ? inspectRuntime(runtime) : null;
    },
    shutdown() {
      for (const runtime of runtimes.values()) {
        if (runtime.idle) Effect.runFork(Fiber.interrupt(runtime.idle));
        log("shutdown", runtime.sessionId, { runtimeId: runtime.runtimeId });
      }
      runtimes.clear();
    },
  };
}
