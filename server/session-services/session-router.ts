import { Effect, Layer } from "effect";
import { detectSessionBackend } from "../session-id.ts";
import { enqueueOpenCodeDeliveryJob } from "../opencode/durable-delivery.ts";
import { enqueueT3DeliveryJob } from "../t3/durable-delivery.ts";
import { enqueuePaseoDeliveryJob } from "../paseo/durable-delivery.ts";
import {
  ClaudeSessionLayers,
  CodexSessionLayers,
  GrokSessionLayers,
  CursorSessionLayers,
  ClaudeDeliveryLayer,
  CodexDeliveryLayer,
  GrokDeliveryLayer,
  CursorDeliveryLayer,
  ClaudeCurrentModelLayer,
  CodexCurrentModelLayer,
  GrokCurrentModelLayer,
  CursorCurrentModelLayer,
  PaseoSessionLayers,
} from "./provider-layers.ts";
import {
  SessionActivity,
  SessionCurrentModel,
  SessionDelivery,
  SessionStopper,
  SessionTitle,
  type DeliveryEnqueueInput,
  type SessionActivityService,
  type SessionCurrentModelService,
  type SessionDeliveryService,
  type SessionRouterError,
  type SessionStopperService,
  type SessionTitleService,
} from "./interfaces.ts";

export type { SessionRouterError } from "./interfaces.ts";

function failWithBackend(backend: string): Effect.Effect<never, SessionRouterError> {
  return Effect.fail({
    _tag: "SessionRouterError" as const,
    message: `No session service for backend: ${backend}`,
  });
}

function sessionRouterError(cause: unknown): SessionRouterError {
  return {
    _tag: "SessionRouterError",
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

/** Returns the merged Layer for a backend, or undefined for "none"/"opencode". */
export function layerForBackend(
  backend: string,
): Layer.Layer<SessionActivityService | SessionStopperService | SessionTitleService> | undefined {
  switch (backend) {
    case "claude":
      return ClaudeSessionLayers;
    case "codex":
      return CodexSessionLayers;
    case "grok":
      return GrokSessionLayers;
    case "cursor":
      return CursorSessionLayers;
    case "paseo":
    case "paseo-chat":
      return PaseoSessionLayers;
    default:
      return undefined;
  }
}

export function withSessionActivity<RA, EA, A>(
  sessionId: string,
  f: (service: SessionActivityService) => Effect.Effect<A, EA, RA>,
): Effect.Effect<A, EA | SessionRouterError, RA> {
  const backend = detectSessionBackend(sessionId);
  if (backend === "none" || backend === "voice" || backend === "opencode") {
    return failWithBackend(backend);
  }
  const layer = layerForBackend(backend);
  if (!layer) {
    return failWithBackend(backend);
  }
  return Effect.gen(function* () {
    const service = yield* SessionActivity;
    return yield* f(service);
  }).pipe(Effect.provide(layer));
}

export function withSessionStopper<RS, ES, A>(
  sessionId: string,
  f: (service: SessionStopperService) => Effect.Effect<A, ES, RS>,
): Effect.Effect<A, ES | SessionRouterError, RS> {
  const backend = detectSessionBackend(sessionId);
  if (backend === "none" || backend === "voice" || backend === "opencode") {
    return failWithBackend(backend);
  }
  const layer = layerForBackend(backend);
  if (!layer) {
    return failWithBackend(backend);
  }
  return Effect.gen(function* () {
    const service = yield* SessionStopper;
    return yield* f(service);
  }).pipe(Effect.provide(layer));
}

export function withSessionTitle<RT, ET, A>(
  sessionId: string,
  f: (service: SessionTitleService) => Effect.Effect<A, ET, RT>,
): Effect.Effect<A, ET | SessionRouterError, RT> {
  const backend = detectSessionBackend(sessionId);
  if (backend === "none" || backend === "voice" || backend === "opencode") {
    return failWithBackend(backend);
  }
  const layer = layerForBackend(backend);
  if (!layer) {
    return failWithBackend(backend);
  }
  return Effect.gen(function* () {
    const service = yield* SessionTitle;
    return yield* f(service);
  }).pipe(Effect.provide(layer));
}

export function deliveryLayerForBackend(
  backend: string,
): Layer.Layer<SessionDeliveryService> | undefined {
  switch (backend) {
    case "claude":
      return ClaudeDeliveryLayer;
    case "codex":
      return CodexDeliveryLayer;
    case "grok":
      return GrokDeliveryLayer;
    case "cursor":
      return CursorDeliveryLayer;
    default:
      return undefined;
  }
}

export function currentModelLayerForBackend(
  backend: string,
): Layer.Layer<SessionCurrentModelService> | undefined {
  switch (backend) {
    case "claude":
      return ClaudeCurrentModelLayer;
    case "codex":
      return CodexCurrentModelLayer;
    case "grok":
      return GrokCurrentModelLayer;
    case "cursor":
      return CursorCurrentModelLayer;
    default:
      return undefined;
  }
}

export function withSessionCurrentModel<R, E, A>(
  sessionId: string,
  f: (service: SessionCurrentModelService) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SessionRouterError, R> {
  const backend = detectSessionBackend(sessionId);
  if (backend === "none" || backend === "voice" || backend === "opencode") {
    return failWithBackend(backend);
  }
  const layer = currentModelLayerForBackend(backend);
  if (!layer) {
    return failWithBackend(backend);
  }
  return Effect.gen(function* () {
    const service = yield* SessionCurrentModel;
    return yield* f(service);
  }).pipe(Effect.provide(layer));
}

export function enqueueDelivery(
  sessionId: string,
  input: DeliveryEnqueueInput,
): Effect.Effect<void, SessionRouterError> {
  const backend = detectSessionBackend(sessionId);
  // voice and none: explicit no delivery (do not fall through to OpenCode).
  if (backend === "none" || backend === "voice") return failWithBackend(backend);

  if (backend === "opencode") {
    return Effect.try({
      try: () => {
        enqueueOpenCodeDeliveryJob({
          messageId: input.messageId,
          messageSessionId: input.messageSessionId,
          opencodeSessionId: sessionId,
          kind: input.kind,
          useCli: input.useCli,
          force: input.forceOpencode,
        });
      },
      catch: sessionRouterError,
    });
  }

  if (backend === "t3") {
    return Effect.try({
      try: () => {
        enqueueT3DeliveryJob({
          messageId: input.messageId,
          messageSessionId: input.messageSessionId,
          t3SessionId: sessionId,
          kind: input.kind,
        });
      },
      catch: sessionRouterError,
    });
  }

  if (backend === "paseo" || backend === "paseo-chat") {
    return Effect.try({
      try: () => {
        enqueuePaseoDeliveryJob({
          messageId: input.messageId,
          messageSessionId: input.messageSessionId,
          paseoSessionId: sessionId,
          kind: input.kind,
        });
      },
      catch: sessionRouterError,
    });
  }

  const layer = deliveryLayerForBackend(backend);
  if (!layer) return failWithBackend(backend);

  return Effect.gen(function* () {
    const delivery = yield* SessionDelivery;
    yield* delivery.enqueue(input, sessionId);
  }).pipe(Effect.provide(layer));
}
