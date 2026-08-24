import { Effect, Layer } from "effect";
import { getClaudeActivitySnapshot, subscribeClaudeActivity } from "../claude/activity-hub.ts";
import { readClaudeCurrentModel } from "../claude/current-model.ts";
import { enqueueClaudeDeliveryJob } from "../claude/durable-delivery.ts";
import { stopClaudeSession } from "../claude/stop.ts";
import { readClaudeTitle } from "../claude/title.ts";
import { getCodexActivitySnapshot, subscribeCodexActivity } from "../codex/activity-hub.ts";
import { readCodexCurrentModel, readCodexSessionModel } from "../codex/current-model.ts";
import { enqueueCodexDeliveryJob } from "../codex/durable-delivery.ts";
import { stopCodexSession } from "../codex/stop.ts";
import { readCodexTitle } from "../codex/title.ts";
import { getGrokActivitySnapshot, subscribeGrokActivity } from "../grok/activity-hub.ts";
import { readGrokCurrentModel, readGrokSessionModel } from "../grok/current-model.ts";
import { enqueueGrokDeliveryJob } from "../grok/durable-delivery.ts";
import { stopGrokSession } from "../grok/stop.ts";
import { readGrokTitle } from "../grok/title.ts";
import { getCursorActivitySnapshot, subscribeCursorActivity } from "../cursor/activity-hub.ts";
import { readCursorCurrentModel } from "../cursor/current-model.ts";
import { enqueueCursorDeliveryJob } from "../cursor/durable-delivery.ts";
import { stopCursorSession } from "../cursor/stop.ts";
import { stopPaseoSession } from "../paseo/stop.ts";
import { getPaseoActivitySnapshot, subscribePaseoActivity } from "../paseo/activity-hub.ts";
import { readCursorTitle } from "../cursor/title.ts";
import { externalCliTitleCacheMs } from "../config.ts";
import { createSessionActivityAdapter } from "./activity-adapter.ts";
import { createSessionStopperAdapter } from "./stop-adapter.ts";
import { makeCachedTitleLayer } from "./cached-titles.ts";
import {
  interruptBusyCliTurnForForceSend,
  type CliForceInterruptBackend,
} from "../external-cli/cli-force-interrupt.ts";
import {
  SessionActivity,
  SessionCurrentModel,
  SessionDelivery,
  SessionStopper,
  SessionTitle,
  type DeliveryEnqueueInput,
  type SessionActivityService,
  type SessionDeliveryService,
  type SessionCurrentModelService,
  type SessionRouterError,
  type SessionStopperService,
} from "./interfaces.ts";

function deliveryEnqueueError(cause: unknown): SessionRouterError {
  return {
    _tag: "SessionRouterError",
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

/**
 * Shared body of every external-CLI enqueue. A composer force variant is
 * Stop-then-deliver on CLI backends (docs/spec/force-send.md): whatever
 * provider turn holds the session goes through the Stop flow first, then the
 * forced prompt enqueues with its force flag so it claims immediately.
 */
function cliDeliveryEnqueue(
  backend: CliForceInterruptBackend,
  targetSessionId: string,
  input: DeliveryEnqueueInput,
  enqueueJob: () => void,
): Effect.Effect<void, SessionRouterError> {
  return Effect.gen(function* () {
    if (input.forceOpencode) {
      yield* Effect.promise(() =>
        interruptBusyCliTurnForForceSend(backend, targetSessionId, input.messageId),
      );
    }
    yield* Effect.try({
      try: enqueueJob,
      catch: deliveryEnqueueError,
    });
  });
}

const ClaudeActivityLive: SessionActivityService = createSessionActivityAdapter({
  getSnapshot: getClaudeActivitySnapshot,
  subscribe: subscribeClaudeActivity,
});

const ClaudeStopperLive: SessionStopperService = createSessionStopperAdapter({
  stopSession: stopClaudeSession,
});

const ClaudeTitleLive = makeCachedTitleLayer(
  (sessionId) => Effect.sync(() => readClaudeTitle(sessionId)),
  externalCliTitleCacheMs,
);

const ClaudeDeliveryLive: SessionDeliveryService = {
  enqueue: (input, targetSessionId) =>
    cliDeliveryEnqueue("claude", targetSessionId, input, () => {
      enqueueClaudeDeliveryJob({
        messageId: input.messageId,
        messageSessionId: input.messageSessionId,
        claudeSessionId: targetSessionId,
        kind: input.kind,
        force: input.forceOpencode,
      });
    }),
};

export const ClaudeSessionLayers = Layer.mergeAll(
  Layer.succeed(SessionActivity, ClaudeActivityLive),
  Layer.succeed(SessionStopper, ClaudeStopperLive),
  ClaudeTitleLive,
);

export const ClaudeDeliveryLayer = Layer.succeed(SessionDelivery, ClaudeDeliveryLive);

const CodexActivityLive: SessionActivityService = createSessionActivityAdapter({
  getSnapshot: getCodexActivitySnapshot,
  subscribe: subscribeCodexActivity,
});

const CodexStopperLive: SessionStopperService = createSessionStopperAdapter({
  stopSession: stopCodexSession,
});

const CodexTitleLive = makeCachedTitleLayer(
  (sessionId) => Effect.sync(() => readCodexTitle(sessionId)),
  externalCliTitleCacheMs,
);

const CodexDeliveryLive: SessionDeliveryService = {
  enqueue: (input, targetSessionId) =>
    cliDeliveryEnqueue("codex", targetSessionId, input, () => {
      enqueueCodexDeliveryJob({
        messageId: input.messageId,
        messageSessionId: input.messageSessionId,
        codexSessionId: targetSessionId,
        kind: input.kind,
        force: input.forceOpencode,
      });
    }),
};

export const CodexSessionLayers = Layer.mergeAll(
  Layer.succeed(SessionActivity, CodexActivityLive),
  Layer.succeed(SessionStopper, CodexStopperLive),
  CodexTitleLive,
);

export const CodexDeliveryLayer = Layer.succeed(SessionDelivery, CodexDeliveryLive);

const GrokActivityLive: SessionActivityService = createSessionActivityAdapter({
  getSnapshot: getGrokActivitySnapshot,
  subscribe: subscribeGrokActivity,
});

const GrokStopperLive: SessionStopperService = createSessionStopperAdapter({
  stopSession: stopGrokSession,
});

const GrokTitleLive = makeCachedTitleLayer(
  (sessionId) => Effect.sync(() => readGrokTitle(sessionId)),
  externalCliTitleCacheMs,
);

const GrokDeliveryLive: SessionDeliveryService = {
  enqueue: (input, targetSessionId) =>
    cliDeliveryEnqueue("grok", targetSessionId, input, () => {
      enqueueGrokDeliveryJob({
        messageId: input.messageId,
        messageSessionId: input.messageSessionId,
        grokSessionId: targetSessionId,
        kind: input.kind,
        force: input.forceOpencode,
      });
    }),
};

export const GrokSessionLayers = Layer.mergeAll(
  Layer.succeed(SessionActivity, GrokActivityLive),
  Layer.succeed(SessionStopper, GrokStopperLive),
  GrokTitleLive,
);

export const GrokDeliveryLayer = Layer.succeed(SessionDelivery, GrokDeliveryLive);

const CursorActivityLive: SessionActivityService = createSessionActivityAdapter({
  getSnapshot: getCursorActivitySnapshot,
  subscribe: subscribeCursorActivity,
});

const CursorStopperLive: SessionStopperService = createSessionStopperAdapter({
  stopSession: stopCursorSession,
});

const CursorTitleLive = makeCachedTitleLayer(
  (sessionId) => Effect.sync(() => readCursorTitle(sessionId)),
  externalCliTitleCacheMs,
);

const CursorDeliveryLive: SessionDeliveryService = {
  enqueue: (input, targetSessionId) =>
    cliDeliveryEnqueue("cursor", targetSessionId, input, () => {
      enqueueCursorDeliveryJob({
        messageId: input.messageId,
        messageSessionId: input.messageSessionId,
        cursorSessionId: targetSessionId,
        kind: input.kind,
        force: input.forceOpencode,
      });
    }),
};

export const CursorSessionLayers = Layer.mergeAll(
  Layer.succeed(SessionActivity, CursorActivityLive),
  Layer.succeed(SessionStopper, CursorStopperLive),
  CursorTitleLive,
);

export const CursorDeliveryLayer = Layer.succeed(SessionDelivery, CursorDeliveryLive);

const PaseoActivityLive: SessionActivityService = createSessionActivityAdapter({
  getSnapshot: getPaseoActivitySnapshot,
  subscribe: subscribePaseoActivity,
});

const PaseoStopperLive: SessionStopperService = createSessionStopperAdapter({
  stopSession: stopPaseoSession,
});

export const PaseoSessionLayers = Layer.mergeAll(
  Layer.succeed(SessionActivity, PaseoActivityLive),
  Layer.succeed(SessionStopper, PaseoStopperLive),
  Layer.succeed(SessionTitle, { getTitle: () => Effect.succeed(null) }),
);

const GrokCurrentModelLive: SessionCurrentModelService = {
  getCurrentModel: (sessionId) => {
    const result = readGrokSessionModel(sessionId) ?? readGrokCurrentModel();
    if (!result)
      return Effect.fail({
        _tag: "CurrentModelError" as const,
        message: "Unable to read Grok current model.",
      });
    return Effect.succeed(result);
  },
};

const CodexCurrentModelLive: SessionCurrentModelService = {
  getCurrentModel: (sessionId) => {
    const result = readCodexSessionModel(sessionId) ?? readCodexCurrentModel();
    if (!result)
      return Effect.fail({
        _tag: "CurrentModelError" as const,
        message: "Unable to read Codex current model.",
      });
    return Effect.succeed(result);
  },
};

const CursorCurrentModelLive: SessionCurrentModelService = {
  getCurrentModel: (_sessionId) => {
    const result = readCursorCurrentModel();
    if (!result)
      return Effect.fail({
        _tag: "CurrentModelError" as const,
        message: "Unable to read Cursor current model.",
      });
    return Effect.succeed(result);
  },
};

const ClaudeCurrentModelLive: SessionCurrentModelService = {
  getCurrentModel: (_sessionId) => {
    const result = readClaudeCurrentModel();
    if (!result)
      return Effect.fail({
        _tag: "CurrentModelError" as const,
        message: "Unable to read Claude current model.",
      });
    return Effect.succeed(result);
  },
};

export const GrokCurrentModelLayer = Layer.succeed(SessionCurrentModel, GrokCurrentModelLive);
export const CodexCurrentModelLayer = Layer.succeed(SessionCurrentModel, CodexCurrentModelLive);
export const CursorCurrentModelLayer = Layer.succeed(SessionCurrentModel, CursorCurrentModelLive);
export const ClaudeCurrentModelLayer = Layer.succeed(SessionCurrentModel, ClaudeCurrentModelLive);
