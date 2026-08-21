import type { OpenCodeStatus, WaitingStatePayload } from "../src/types.ts";
import { Clock, Context, Duration, Effect, Layer } from "effect";
import { getOpenCodeActivityPreview } from "./opencode/activity.ts";
import { getOpenCodeStatus } from "./opencode/client.ts";
import { getWaitingState } from "./waiting-state.ts";
import type { deserializeMessage } from "./messages.ts";

type Message = ReturnType<typeof deserializeMessage>;
export type JarvisStatusActivityPreview = {
  status: unknown;
  recentItems: Array<{
    kind?: unknown;
    snippet?: unknown;
    timestamp?: unknown;
    partial?: unknown;
  }>;
} & Record<string, unknown>;

export type JarvisStatusOpenCodeService = {
  getStatus: (sessionId: string) => Effect.Effect<OpenCodeStatus | null>;
  getActivityPreview: (
    sessionId: string,
    limit: number,
  ) => Effect.Effect<JarvisStatusActivityPreview>;
  getWaitingState: (sessionId: string) => Effect.Effect<WaitingStatePayload>;
};

export const JarvisStatusOpenCode = Context.GenericTag<JarvisStatusOpenCodeService>(
  "say-to-me/JarvisStatusOpenCode",
);

export const JarvisStatusOpenCodeLive = Layer.succeed(JarvisStatusOpenCode, {
  getStatus: (sessionId) =>
    Effect.promise(() => getOpenCodeStatus(sessionId, { forceRefresh: true })),
  getActivityPreview: (sessionId, limit) =>
    Effect.promise(() => getOpenCodeActivityPreview(sessionId, limit)),
  getWaitingState: (sessionId) => Effect.promise(() => getWaitingState(sessionId)),
} satisfies JarvisStatusOpenCodeService);

const extraMarkdownPreviewLength = 240;
const activitySnippetPreviewLength = 200;
const maxWaitMs = 300_000;
const defaultWaitMs = 1_000;
const defaultLimit = 3;
const maxLimit = 50;
const waitPollMs = 100;

function isIdleSystemNotice(text: string): boolean {
  return /^<say-to-me-system>[^<]+ is idle now(?: after [^<]+)?<\/say-to-me-system>$/.test(
    text.trim(),
  );
}

function previewExtraMarkdown(extraMarkdown: string | null): string | null {
  if (!extraMarkdown) return null;
  const compact = extraMarkdown.replace(/\s+/g, " ").trim();
  if (compact.length <= extraMarkdownPreviewLength) return compact;
  return `${compact.slice(0, extraMarkdownPreviewLength - 3)}...`;
}

function compactSessions(message: Message) {
  return message.sessions.map(({ id, waitingState, latestActivity }) =>
    dropCompactEmptyValues({
      id,
      waitingState,
      latestActivity,
    }),
  );
}

function compactActivityItem(item: {
  kind?: unknown;
  snippet?: unknown;
  timestamp?: unknown;
  partial?: unknown;
}) {
  return dropCompactEmptyValues({
    kind: item.kind,
    snippet:
      typeof item.snippet === "string"
        ? previewText(item.snippet, activitySnippetPreviewLength)
        : item.snippet,
    timestamp: item.timestamp,
    partial: item.partial,
  });
}

function previewText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3)}...`;
}

function dropCompactEmptyValues(fields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => {
      if (value == null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  );
}

export function parseStatusWait(raw: unknown): { ok: true; waitMs: number } | { ok: false } {
  if (raw == null) return { ok: true, waitMs: defaultWaitMs };
  const value = Array.isArray(raw) ? raw.at(-1) : raw;
  if (typeof value !== "string" || value.trim() === "") return { ok: false };
  const match =
    /^(\d+(?:\.\d+)?)(ms|msec|millisecond|milliseconds|s|sec|secs|second|seconds|m|min|mins|minute|minutes)?$/i.exec(
      value.trim(),
    );
  if (!match) return { ok: false };
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false };
  const unit = (match[2] ?? "ms").toLowerCase();
  const multiplier =
    unit === "m" || unit.startsWith("min") ? 60_000 : unit.startsWith("s") ? 1000 : 1;
  const waitMs = Math.round(amount * multiplier);
  if (waitMs > maxWaitMs) return { ok: false };
  return { ok: true, waitMs };
}

export function parseLimit(raw: unknown): { ok: true; limit: number } | { ok: false } {
  if (raw == null) return { ok: true, limit: defaultLimit };
  const value = Array.isArray(raw) ? raw.at(-1) : raw;
  if (typeof value !== "string" || value.trim() === "") return { ok: false };
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) return { ok: false };
  return { ok: true, limit };
}

export function parseExtended(raw: unknown): { ok: true; extended: boolean } | { ok: false } {
  if (raw == null) return { ok: true, extended: false };
  const value = Array.isArray(raw) ? raw.at(-1) : raw;
  if (typeof value !== "string") return { ok: false };
  const normalized = value.trim().toLowerCase();
  if (normalized === "" || normalized === "true" || normalized === "1") {
    return { ok: true, extended: true };
  }
  if (normalized === "false" || normalized === "0") return { ok: true, extended: false };
  return { ok: false };
}

export function parseSince(raw: unknown): { ok: true; since: number | null } | { ok: false } {
  if (raw == null) return { ok: true, since: null };
  const value = Array.isArray(raw) ? raw.at(-1) : raw;
  if (typeof value !== "string" || value.trim() === "") return { ok: false };
  const since = Number(value);
  if (!Number.isInteger(since) || since < 0) return { ok: false };
  return { ok: true, since };
}

export type JarvisStatusWaitResult = {
  opencodeState: OpenCodeStatus | null;
  waitedMs: number;
  timedOut: boolean;
};

function getFreshOpenCodeStatusEffect(sessionId: string) {
  return Effect.gen(function* () {
    const openCode = yield* JarvisStatusOpenCode;
    return yield* openCode.getStatus(sessionId);
  });
}

type WaitForIdleStatusOptions = {
  getStatusEffect?: (
    sessionId: string,
  ) => Effect.Effect<OpenCodeStatus | null, never, JarvisStatusOpenCodeService>;
  getWaitingStateEffect?: (
    sessionId: string,
  ) => Effect.Effect<WaitingStatePayload, never, JarvisStatusOpenCodeService>;
  pollMs?: number;
};

/**
 * Busy enough to keep long-polling. OpenCode `pending` covers the original
 * path; `waitingState.working` covers CLI backends where `opencodeState` is
 * null but the payload already knows the agent is mid-turn. Either signal
 * alone is enough — a CLI session must not return `timedOut: false` with
 * `waitedMs: 0` while still working.
 */
function isWaitingForIdle(
  opencodeState: OpenCodeStatus | null,
  waitingState: WaitingStatePayload,
): boolean {
  return opencodeState === "pending" || waitingState.state === "working";
}

function getFreshWaitingStateEffect(sessionId: string) {
  return Effect.gen(function* () {
    const openCode = yield* JarvisStatusOpenCode;
    return yield* openCode.getWaitingState(sessionId);
  });
}

export function waitForIdleStatusEffect(
  sessionId: string,
  waitMs: number,
  {
    getStatusEffect = getFreshOpenCodeStatusEffect,
    getWaitingStateEffect = getFreshWaitingStateEffect,
    pollMs = waitPollMs,
  }: WaitForIdleStatusOptions = {},
): Effect.Effect<JarvisStatusWaitResult, never, JarvisStatusOpenCodeService> {
  return Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    let opencodeState = yield* getStatusEffect(sessionId);
    let waitingState = yield* getWaitingStateEffect(sessionId);
    if (!isWaitingForIdle(opencodeState, waitingState) || waitMs <= 0) {
      return {
        opencodeState,
        waitedMs: (yield* Clock.currentTimeMillis) - started,
        timedOut: false,
      };
    }

    let elapsedMs = (yield* Clock.currentTimeMillis) - started;
    while (elapsedMs < waitMs) {
      const remainingMs = waitMs - elapsedMs;
      yield* Effect.sleep(Duration.millis(Math.min(pollMs, remainingMs)));
      opencodeState = yield* getStatusEffect(sessionId);
      waitingState = yield* getWaitingStateEffect(sessionId);
      if (!isWaitingForIdle(opencodeState, waitingState)) {
        return {
          opencodeState,
          waitedMs: (yield* Clock.currentTimeMillis) - started,
          timedOut: false,
        };
      }
      elapsedMs = (yield* Clock.currentTimeMillis) - started;
    }

    return { opencodeState, waitedMs: elapsedMs, timedOut: true };
  });
}

export function waitForIdleStatus(
  sessionId: string,
  waitMs: number,
): Promise<JarvisStatusWaitResult> {
  return Effect.runPromise(
    waitForIdleStatusEffect(sessionId, waitMs).pipe(Effect.provide(JarvisStatusOpenCodeLive)),
  );
}

function nextPullCursor({
  extended,
  limit,
  waitMs,
  since,
}: {
  extended: boolean;
  limit: number;
  waitMs: number;
  since: number;
}) {
  const params = new URLSearchParams({
    extended: extended ? "1" : "0",
    limit: String(limit),
    wait: String(waitMs),
    since: String(since),
  });
  return `?${params.toString()}`;
}

export function compactMessages(
  messages: Message[],
  { anchorMessageId = null, extended }: { anchorMessageId?: number | null; extended: boolean },
) {
  const summarized: unknown[] = [];
  for (const message of messages) {
    if (message.id !== anchorMessageId && isIdleSystemNotice(message.text)) continue;

    if (extended) {
      summarized.push(message);
      continue;
    }

    summarized.push(
      dropCompactEmptyValues({
        id: message.id,
        author: message.author,
        text: message.text,
        createdAt: message.createdAt,
        links: message.links,
        sessions: compactSessions(message),
        forwardRole: message.forwardRole,
        forwardSourceSessionId: message.forwardSourceSessionId,
        forwardSourceMessageId: message.forwardSourceMessageId,
        forwardTargetSessionId: message.forwardTargetSessionId,
        forwardTargetMessageId: message.forwardTargetMessageId,
        forwardStatus: message.forwardStatus,
        extraMarkdownPreview: previewExtraMarkdown(message.extraMarkdown),
      }),
    );
  }

  return {
    messages: summarized,
  };
}

function visibleMessagesWithCursor(
  messages: Message[],
  limit: number,
  fallbackSince: number,
  anchorMessageId: number | null = null,
) {
  const candidates = messages.filter(
    (message) => message.id === anchorMessageId || !isIdleSystemNotice(message.text),
  );
  const anchorIndex =
    anchorMessageId == null
      ? -1
      : candidates.findIndex((message) => message.id === anchorMessageId);
  const visible =
    anchorIndex >= 0
      ? candidates.slice(anchorIndex, anchorIndex + limit)
      : candidates.slice(-limit);
  const visibleIds = new Set(visible.map((message) => message.id));
  const cursorSince = visible.at(-1)?.id ?? fallbackSince;
  const otherMessages = candidates
    .filter((message) => !visibleIds.has(message.id))
    .map((message) => message.id);
  return { cursorSince, otherMessages, visible };
}

type BuildJarvisStatusOptions = {
  sessionId: string;
  messages: Message[];
  wait: JarvisStatusWaitResult;
  since: number | null;
  extended: boolean;
  limit: number;
  waitMs: number;
  anchorMessageId?: number | null;
};

export function buildJarvisStatusEffect({
  sessionId,
  messages,
  wait,
  since,
  extended,
  limit,
  waitMs,
  anchorMessageId = null,
}: BuildJarvisStatusOptions) {
  return Effect.gen(function* () {
    const openCode = yield* JarvisStatusOpenCode;
    const activityLimit = extended ? 5 : 2;
    const { waitingState, activity } = yield* Effect.all(
      {
        waitingState: openCode.getWaitingState(sessionId),
        activity: openCode.getActivityPreview(sessionId, activityLimit),
      },
      { concurrency: "unbounded" },
    );
    const filtered = since == null ? messages : messages.filter((message) => message.id > since);
    const { cursorSince, otherMessages, visible } = visibleMessagesWithCursor(
      filtered,
      limit,
      since ?? 0,
      anchorMessageId,
    );
    const summary = compactMessages(visible, { anchorMessageId, extended });

    return {
      sessionId,
      nextPullCursor: nextPullCursor({ extended, limit, waitMs, since: cursorSince }),
      opencodeState: wait.opencodeState,
      opencodeActivity: extended
        ? activity
        : dropCompactEmptyValues({
            status: activity.status,
            recentItems: activity.recentItems
              .slice(0, activityLimit)
              .map((item) => compactActivityItem(item)),
          }),
      messages: summary.messages,
      ...(extended || otherMessages.length > 0 ? { otherMessages } : {}),
      waitingState,
      wait: {
        requestedMs: waitMs,
        waitedMs: wait.waitedMs,
        timedOut: wait.timedOut,
      },
      params: {
        since,
        limit,
        extended,
        wait: waitMs,
        ...(anchorMessageId == null ? {} : { anchorMessageId }),
      },
    };
  });
}

export function buildJarvisStatus(options: BuildJarvisStatusOptions) {
  return Effect.runPromise(
    buildJarvisStatusEffect(options).pipe(Effect.provide(JarvisStatusOpenCodeLive)),
  );
}
