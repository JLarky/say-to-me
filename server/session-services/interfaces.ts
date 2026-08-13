import { Context, Effect } from "effect";
import type { ActivityListener, ActivitySnapshot } from "../activityHub.ts";

export type ActivityError = {
  readonly _tag: "ActivityError";
  readonly message: string;
};

export type StopError = {
  readonly _tag: "StopError";
  readonly message: string;
  readonly status?: number;
};

export type TitleError = {
  readonly _tag: "TitleError";
  readonly message: string;
};

export type DeliveryEnqueueInput = {
  messageId: number;
  messageSessionId: string;
  kind: "direct_user_message" | "forward_target_message";
  useCli?: boolean;
  forceOpencode?: boolean;
};

export type SessionRouterError = {
  readonly _tag: "SessionRouterError";
  readonly message: string;
};

export type SessionDeliveryService = {
  enqueue: (
    input: DeliveryEnqueueInput,
    targetSessionId: string,
  ) => Effect.Effect<void, SessionRouterError>;
};

export type SessionActivityService = {
  getSnapshot: (
    sessionId: string,
    limit?: number,
  ) => Effect.Effect<ActivitySnapshot, ActivityError>;
  subscribe: (
    sessionId: string,
    limit: number,
    listener: ActivityListener<ActivitySnapshot>,
  ) => () => void;
};

export type SessionStopperService = {
  stop: (
    sessionId: string,
  ) => Effect.Effect<{ ok: true } | { ok: false; status: number; error: string }, StopError>;
};

export type SessionTitleService = {
  getTitle: (sessionId: string) => Effect.Effect<string | null>;
};

export const SessionActivity = Context.GenericTag<SessionActivityService>(
  "say-to-me/SessionActivity",
);
export const SessionStopper = Context.GenericTag<SessionStopperService>("say-to-me/SessionStopper");
export const SessionTitle = Context.GenericTag<SessionTitleService>("say-to-me/SessionTitle");
export const SessionDelivery = Context.GenericTag<SessionDeliveryService>(
  "say-to-me/SessionDelivery",
);

export type CurrentModelResult = {
  readonly providerID: string;
  readonly modelID: string;
};

export type CurrentModelError = {
  readonly _tag: "CurrentModelError";
  readonly message: string;
};

export type SessionCurrentModelService = {
  /** Prefer per-session provider state when available (see docs/spec/model-reset.md). */
  getCurrentModel: (sessionId: string) => Effect.Effect<CurrentModelResult, CurrentModelError>;
};

export const SessionCurrentModel = Context.GenericTag<SessionCurrentModelService>(
  "say-to-me/SessionCurrentModel",
);
