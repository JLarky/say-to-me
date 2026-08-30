import { type as arktype } from "arktype";
import { SessionState } from "../../src/types.ts";

// ---------------------------------------------------------------------------
// DB row schemas — arktype validates runtime data at trust boundaries.
// ---------------------------------------------------------------------------

/**
 * Raw DB row for a message. Intentionally differs from the client `Message`
 * type in src/types.ts in two key ways:
 *  1. `links` is a JSON string (`string | null`) here; the client deserializes
 *     it to `string[] | null` in `parseLinks()`.
 *  2. `id` is always `number` (DB primary key); the client widens it to
 *     `number | string` to accommodate optimistic pending messages.
 * Client-only fields (`pending`, `error`, `useCli`) are not stored in the DB.
 */
export const DbMessage = arktype({
  id: "number",
  sessionId: "string",
  text: "string",
  extraMarkdown: "string | null",
  pushNotificationText: "string | null",
  status: "string",
  pinned: "number",
  author: "'agent' | 'user'",
  parentId: "number | null",
  attachedSessionId: "string | null",
  opencodeDeliveryStatus: "string | null",
  opencodeDeliveryError: "string | null",
  opencodeMessageId: "string | null",
  clientMessageId: "string | null",
  links: "string | null",
  sessionRefs: "string | null",
  mergedIntoMessageId: "number | null",
  forwardRole: "string | null",
  forwardSourceSessionId: "string | null",
  forwardSourceMessageId: "number | null",
  forwardTargetSessionId: "string | null",
  forwardTargetMessageId: "number | null",
  forwardStatus: "string | null",
  completionWatchStatus: "string | null",
  completionWatchWorkSeen: "number",
  completionWatchNextCheckAt: "number",
  completionSourceSessionId: "string | null",
  completionSourceMessageId: "number | null",
  completionTargetNotificationMessageId: "number | null",
  completionSourceNotificationMessageId: "number | null",
  paseoAuthor: "string | null",
  paseoAuthorName: "string | null",
  createdAt: "string",
});
export type DbMessage = typeof DbMessage.infer;

/**
 * Raw DB row for a session. The client `Session` type in src/types.ts extends
 * this with computed/API-only fields (`href`, `opencodeTitle`,
 * `opencodeStatus`, `opencodeDirB64`) that are never stored in the DB.
 */
export const DbSession = arktype({
  id: "string",
  state: SessionState,
  alias: "string | null",
  revision: "number",
  createdAt: "string",
  updatedAt: "string",
  "messageCount?": "number",
  "opencodeProjectId?": "string | null",
  "opencodeWorkspaceId?": "string | null",
  "opencodeDirectory?": "string | null",
  "opencodeWorktree?": "string | null",
  "opencodePath?": "string | null",
  "opencodeProjectName?": "string | null",
  "opencodeBranch?": "string | null",
  "opencodeSelectedModelProvider?": "string | null",
  "opencodeSelectedModel?": "string | null",
  "reasoningEffort?": "string | null",
  "cwd?": "string | null",
  "t3InstanceId?": "string | null",
  "paseoInstanceId?": "string | null",
});
export type DbSession = typeof DbSession.infer;

export const DbPushSubscription = arktype({
  endpoint: "string",
  p256dh: "string",
  auth: "string",
  createdAt: "string",
});
export type DbPushSubscription = typeof DbPushSubscription.infer;

export const DbNote = arktype({
  id: "number",
  sessionId: "string",
  content: "string",
  createdAt: "string",
});
export type DbNote = typeof DbNote.infer;

export const DbAttachment = arktype({
  id: "number",
  messageId: "number",
  filePath: "string",
  originalName: "string",
  mimeType: "string",
  thumbnailDataUrl: "string",
  thumbnailWidth: "number",
  thumbnailHeight: "number",
  createdAt: "string",
});
export type DbAttachment = typeof DbAttachment.infer;

export const DbNotification = arktype({
  id: "number",
  sessionId: "string",
  sessionTitle: "string",
  title: "string",
  body: "string",
  url: "string",
  dismissedAt: "string | null",
  createdAt: "string",
});
export type DbNotification = typeof DbNotification.infer;

export const DbOpenCodeDeliveryJob = arktype({
  id: "number",
  messageId: "number",
  messageSessionId: "string",
  opencodeSessionId: "string",
  kind: "string",
  status: "string",
  useCli: "number",
  force: "number",
  attemptCount: "number",
  maxAttempts: "number",
  nextAttemptAt: "number",
  lockedAt: "number | null",
  lockedBy: "string | null",
  lastError: "string | null",
  opencodeMessageId: "string | null",
  promptDispatchedAt: "number | null",
  cliTurnEndedAt: "number | null",
  createdAt: "string",
  updatedAt: "string",
});
export type DbOpenCodeDeliveryJob = typeof DbOpenCodeDeliveryJob.infer;

export const DbT3DeliveryJob = arktype({
  id: "number",
  messageId: "number",
  messageSessionId: "string",
  t3SessionId: "string",
  kind: "string",
  status: "string",
  attemptCount: "number",
  maxAttempts: "number",
  nextAttemptAt: "number",
  lockedAt: "number | null",
  lockedBy: "string | null",
  lastError: "string | null",
  sequence: "number | null",
  createdAt: "string",
  updatedAt: "string",
});
export type DbT3DeliveryJob = typeof DbT3DeliveryJob.infer;

export const DbPaseoDeliveryJob = arktype({
  id: "number",
  messageId: "number",
  messageSessionId: "string",
  paseoSessionId: "string",
  kind: "string",
  status: "string",
  attemptCount: "number",
  maxAttempts: "number",
  nextAttemptAt: "number",
  lockedAt: "number | null",
  lockedBy: "string | null",
  lastError: "string | null",
  createdAt: "string",
  updatedAt: "string",
});
export type DbPaseoDeliveryJob = typeof DbPaseoDeliveryJob.infer;

export const DbClaudeDeliveryJob = arktype({
  id: "number",
  messageId: "number",
  messageSessionId: "string",
  claudeSessionId: "string",
  kind: "string",
  status: "string",
  /** 1 when an explicit user force-send skipped the wait-for-idle hold. */
  force: "number",
  attemptCount: "number",
  maxAttempts: "number",
  nextAttemptAt: "number",
  lockedAt: "number | null",
  lockedBy: "string | null",
  lastError: "string | null",
  /** Set before the provider prompt is spawned; blocks any re-prompt of this job. */
  promptDispatchedAt: "number | null",
  /** Set when the worker observes the CLI turn end; independent of job status. */
  cliTurnEndedAt: "number | null",
  createdAt: "string",
  updatedAt: "string",
});
export type DbClaudeDeliveryJob = typeof DbClaudeDeliveryJob.infer;

export const DbCursorDeliveryJob = arktype({
  id: "number",
  messageId: "number",
  messageSessionId: "string",
  cursorSessionId: "string",
  kind: "string",
  status: "string",
  /** 1 when an explicit user force-send skipped the wait-for-idle hold. */
  force: "number",
  attemptCount: "number",
  maxAttempts: "number",
  nextAttemptAt: "number",
  lockedAt: "number | null",
  lockedBy: "string | null",
  lastError: "string | null",
  /** Set before the provider prompt is spawned; blocks any re-prompt of this job. */
  promptDispatchedAt: "number | null",
  /** Set when the worker observes the CLI turn end; independent of job status. */
  cliTurnEndedAt: "number | null",
  createdAt: "string",
  updatedAt: "string",
});
export type DbCursorDeliveryJob = typeof DbCursorDeliveryJob.infer;

export const DbCodexDeliveryJob = arktype({
  id: "number",
  messageId: "number",
  messageSessionId: "string",
  codexSessionId: "string",
  kind: "string",
  status: "string",
  /** 1 when an explicit user force-send skipped the wait-for-idle hold. */
  force: "number",
  attemptCount: "number",
  maxAttempts: "number",
  nextAttemptAt: "number",
  lockedAt: "number | null",
  lockedBy: "string | null",
  lastError: "string | null",
  /** Set before the provider prompt is spawned; blocks any re-prompt of this job. */
  promptDispatchedAt: "number | null",
  /** Set when the worker observes the CLI turn end; independent of job status. */
  cliTurnEndedAt: "number | null",
  createdAt: "string",
  updatedAt: "string",
});
export type DbCodexDeliveryJob = typeof DbCodexDeliveryJob.infer;

export const DbGrokDeliveryJob = arktype({
  id: "number",
  messageId: "number",
  messageSessionId: "string",
  grokSessionId: "string",
  kind: "string",
  status: "string",
  /** 1 when an explicit user force-send skipped the wait-for-idle hold. */
  force: "number",
  attemptCount: "number",
  maxAttempts: "number",
  nextAttemptAt: "number",
  lockedAt: "number | null",
  lockedBy: "string | null",
  lastError: "string | null",
  /** Set before the provider prompt is spawned; blocks any re-prompt of this job. */
  promptDispatchedAt: "number | null",
  /** Set when the worker observes the CLI turn end; independent of job status. */
  cliTurnEndedAt: "number | null",
  createdAt: "string",
  updatedAt: "string",
});
export type DbGrokDeliveryJob = typeof DbGrokDeliveryJob.infer;

export const DbRoutine = arktype({
  id: "number",
  ownerSessionId: "string",
  status: "'active' | 'paused' | 'firing' | 'fired' | 'cancelled' | 'failed'",
  title: "string | null",
  triggerKind: "string",
  trigger: "string",
  action: "string",
  nextFireAt: "number | null",
  lastFiredAt: "number | null",
  lastMessageId: "number | null",
  lockedAt: "number | null",
  lockedBy: "string | null",
  lastError: "string | null",
  createdAt: "string",
  updatedAt: "string",
});
export type DbRoutine = typeof DbRoutine.infer;

export const DbJarvisCreateOperation = arktype({
  id: "string",
  spaceId: "string",
  workspaceIdentity: "string",
  workspaceDirectory: "string",
  alias: "string",
  slug: "string",
  provider: "string",
  providerConfigFingerprint: "string",
  modelId: "string | null",
  reasoningEffort: "string | null",
  phase: "string",
  sessionId: "string | null",
  createdWorkspace: "number",
  createdAttachment: "number",
  providerCreateComplete: "number",
  leasedAt: "number | null",
  leaseOwner: "string | null",
  bootstrapClientMessageId: "string | null",
  bootstrapStatus: "string | null",
  bootstrapError: "string | null",
  error: "string | null",
  createdAt: "string",
  updatedAt: "string",
});
export type DbJarvisCreateOperation = typeof DbJarvisCreateOperation.infer;

/** Shape returned by COUNT(*) aggregate queries. */
export const DbCount = arktype({ count: "number" });
export type DbCount = typeof DbCount.infer;

export function validateDb<T>(
  schema: { assert: (data: unknown) => T },
  data: unknown,
  context: string,
): T {
  try {
    return schema.assert(data);
  } catch (err) {
    throw new Error(
      `DB row failed validation (${context}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
