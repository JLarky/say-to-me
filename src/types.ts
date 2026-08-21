import { type } from "arktype";
import { codexReasoningEfforts } from "./codex-reasoning-effort.ts";

export const openCodeStatuses = [
  "idle" as const,
  "pending" as const,
  "retrying" as const,
  "error" as const,
  "unavailable" as const,
];
export type OpenCodeStatus = (typeof openCodeStatuses)[number];
export const OpenCodeStatus = type.enumerated(...openCodeStatuses);

export const CodexReasoningEffort = type.enumerated(...codexReasoningEfforts);
export type CodexReasoningEffort = typeof CodexReasoningEffort.infer;

/**
 * Waiting-state labels for the session classifier (#116). The enum is the full
 * contract for the future Jinx/LLM classifier; the current heuristic only ever
 * emits the subset backed by structural signals (`needs_answer`, `can_continue`,
 * `working`, `blocked`, `unknown`).
 */
export const waitingStates = [
  "needs_answer" as const,
  "needs_direction" as const,
  "can_continue" as const,
  "working" as const,
  "blocked" as const,
  "review" as const,
  "unknown" as const,
];
export type WaitingState = (typeof waitingStates)[number];
export const WaitingState = type.enumerated(...waitingStates);

/** Shape returned by GET /api/sessions/:id/waiting-state */
export const WaitingStatePayload = type({
  state: WaitingState,
  reason: "string",
  "action?": "string",
  "source?": "'heuristic' | 'jinx'",
});
export type WaitingStatePayload = typeof WaitingStatePayload.infer;

export const sessionStates = [
  "important" as const,
  "general" as const,
  "archived" as const,
  "jarvis" as const,
];
export type SessionState = (typeof sessionStates)[number];
export const SessionState = type.enumerated(...sessionStates);

export const MessageAttachment = type({
  "id?": "number",
  filePath: "string",
  originalName: "string",
  mimeType: "string",
  "url?": "string",
  "thumbnailDataUrl?": "string",
  "thumbnailWidth?": "number",
  "thumbnailHeight?": "number",
  "createdAt?": "string",
});

export type MessageAttachment = typeof MessageAttachment.infer;

export const MessageSessionReference = type({
  id: "string",
  "alias?": "string | null",
  "title?": "string | null",
  "summary?": "string | null",
  "summaryUpdatedAt?": "string | null",
  "waitingState?": "string | null",
  "latestMessageAuthor?": "'agent' | 'user' | null",
  "latestMessageText?": "string | null",
  "state?": "string | null",
  "projectName?": "string | null",
  "workspaceId?": "string | null",
  "latestActivity?": "string | null",
  "messageCount?": "number | null",
  "opencodeStatus?": OpenCodeStatus.or("null"),
  "opencodeActivitySnippet?": "string | null",
});

export type MessageSessionReference = typeof MessageSessionReference.infer;

export const ImageUploadPayload = type({
  attachment: {
    filePath: "string",
    originalName: "string",
    mimeType: "string",
    "thumbnailDataUrl?": "string",
    "thumbnailWidth?": "number",
    "thumbnailHeight?": "number",
  },
});

export type ImageUploadPayload = typeof ImageUploadPayload.infer;

export const AppNotification = type({
  id: "number",
  sessionId: "string",
  sessionTitle: "string",
  title: "string",
  body: "string",
  url: "string",
  dismissedAt: "string | null",
  createdAt: "string",
});
export type AppNotification = typeof AppNotification.infer;

export const NotificationsPayload = type({
  notifications: AppNotification.array(),
});
export type NotificationsPayload = typeof NotificationsPayload.infer;

export const SpaceActivityEvent = type({
  id: "string",
  type: "'message' | 'delivery' | 'notification' | 'timer' | 'attachment'",
  sessionId: "string",
  sessionTitle: "string",
  title: "string",
  detail: "string",
  createdAt: "string",
  url: "string | null",
  dismissedAt: "string | null",
});
export type SpaceActivityEvent = typeof SpaceActivityEvent.infer;

export const SpaceActivityRetention = type({
  messageScanLimit: "number",
  messageScanTruncated: "boolean",
  notificationRetentionLimit: "number",
  maxRangeHours: "number",
  appliedRangeHours: "number",
  rangeClamped: "boolean",
  timerFreshnessNote: "string",
  scopeNote: "string",
});
export type SpaceActivityRetention = typeof SpaceActivityRetention.infer;

export const SpaceActivityPayload = type({
  spaceId: "string",
  spaceName: "string",
  events: SpaceActivityEvent.array(),
  messageLimit: "number",
  timerFreshnessNote: "string",
  retention: SpaceActivityRetention,
});
export type SpaceActivityPayload = typeof SpaceActivityPayload.infer;

/**
 * Client-side message shape. Intentionally differs from the server `DbMessage`
 * schema in server/api.ts:
 *  - `id` is `number | string` to support optimistic pending messages
 *    (which use a temporary string ID until the server confirms).
 *  - `links` is deserialized to `string[] | null` (DB stores a JSON string).
 *  - `clientMessageId` is the browser-generated idempotency key for message POSTs.
 *  - `attachments` is loaded from a separate table and returned as metadata.
 *  - Adds client-only fields: `pending`, `error`, `useCli`.
 *  - Most fields are optional because the API may omit them in list responses.
 */
export const Message = type({
  id: "number | string",
  sessionId: "string",
  text: "string",
  "extraMarkdown?": "string | null",
  "extraMarkdownHtml?": "string",
  "pushNotificationText?": "string | null",
  status: "string",
  "pinned?": "number",
  author: "'agent' | 'user'",
  "parentId?": "number | null",
  "attachedSessionId?": "string | null",
  "opencodeDeliveryStatus?": "string | null",
  "opencodeDeliveryError?": "string | null",
  "opencodeMessageId?": "string | null",
  "mergedIntoMessageId?": "number | null",
  "clientMessageId?": "string | null",
  "links?": "string[] | null",
  "sessions?": MessageSessionReference.array(),
  "forwardRole?": "string | null",
  "forwardSourceSessionId?": "string | null",
  "forwardSourceMessageId?": "number | null",
  "forwardTargetSessionId?": "string | null",
  "forwardTargetMessageId?": "number | null",
  "forwardStatus?": "string | null",
  "completionWatchStatus?": "string | null",
  "completionWatchWorkSeen?": "number",
  "completionSourceSessionId?": "string | null",
  "completionSourceMessageId?": "number | null",
  "completionTargetNotificationMessageId?": "number | null",
  "completionSourceNotificationMessageId?": "number | null",
  "paseoAuthor?": "string | null",
  "paseoAuthorName?": "string | null",
  "attachments?": MessageAttachment.array(),
  "createdAt?": "string",
  // Client-only pending fields
  "pending?": "boolean",
  "error?": "string | null",
  "useCli?": "boolean",
  "forceOpencode?": "boolean",
  "notifyOnCompletion?": "boolean",
  "targetSessionId?": "string | null",
  // Outbound-only: temp-dir image paths sent as an explicit images[] array.
  "images?": "string[]",
});

export type Message = typeof Message.infer;

export const OrganizePathCrumb = type({
  id: "string",
  name: "string",
});

export type OrganizePathCrumb = typeof OrganizePathCrumb.infer;

/**
 * Client-side session shape. Extends the server `DbSession` schema with
 * computed/API-only fields (`href`, `opencodeTitle`,
 * `opencodeStatus`, `opencodeAgent`, `opencodeModelProvider`,
 * `opencodeModel`, `opencodeDirB64`) that are never stored in the DB.
 */
export const Session = type({
  id: "string",
  "state?": SessionState,
  "alias?": "string | null",
  "revision?": "number",
  "createdAt?": "string",
  "updatedAt?": "string",
  "messageCount?": "number",
  "jarvisOverviewDetails?": {
    "latestMessageText?": "string | null",
    "latestMessageAuthor?": "'agent' | 'user' | null",
    "latestMessageCreatedAt?": "string | null",
    "latestOpencodeDeliveryStatus?": "string | null",
    "latestForwardStatus?": "string | null",
    "latestCompletionWatchStatus?": "string | null",
  },
  "href?": "string",
  "backend?":
    "'opencode' | 'codex' | 'grok' | 'claude' | 'cursor' | 't3' | 'paseo' | 'paseo-chat' | 'voice' | 'none'",
  "opencodeTitle?": "string | null",
  "opencodeStatus?": OpenCodeStatus.or("null"),
  // Common OpenCode agents are "build" and "plan", but users can define custom agents.
  "opencodeAgent?": "string | null",
  "opencodeModelProvider?": "string | null",
  "opencodeModel?": "string | null",
  "opencodeSelectedModelProvider?": "string | null",
  "opencodeSelectedModel?": "string | null",
  "reasoningEffort?": "string | null",
  "opencodeDirB64?": "string | null",
  "opencodeProjectId?": "string | null",
  "opencodeWorkspaceId?": "string | null",
  "opencodeDirectory?": "string | null",
  "opencodeWorktree?": "string | null",
  "opencodePath?": "string | null",
  "opencodeProjectName?": "string | null",
  "opencodeBranch?": "string | null",
  "cwd?": "string | null",
  "t3InstanceId?": "string | null",
  "paseoInstanceId?": "string | null",
  "paseoUiUrl?": "string | null",
  "paseoLocalUrl?": "string | null",
  "paseoTailscaleUrl?": "string | null",
  "organizePath?": OrganizePathCrumb.array(),
});

export type Session = typeof Session.infer;

export type ActivityStatus =
  | "busy"
  | "awaiting-input"
  | "idle"
  | "pending"
  | "retrying"
  | "error"
  | "missing"
  | "unknown"
  | null;

export type OpenCodeActivity = {
  type?: "event" | "error";
  saySessionId?: string;
  status?: ActivityStatus;
  statusRaw?: unknown;
  checkedAt?: number;
  freshness?: {
    checkedAt?: number;
    ageMs?: number | null;
    stale?: boolean;
  };
  latestOutputSnippet?: string | null;
  latestActivityTimestamp?: number | null;
  previewSource?: "legacy" | "v2" | "sse" | null;
  identifiers?: {
    messageId?: string | null;
    partId?: string | null;
    eventId?: string | null;
    runId?: string | null;
  };
  contextUsage?: {
    usedTokens?: number | null;
    limitTokens?: number | null;
    percent?: number | null;
    source?: "latestMessageTokens";
  } | null;
  recentItems?: Array<{
    kind?: "message" | "tool" | "thinking" | "compaction" | "question";
    snippet?: string | null;
    snippetHtml?: string;
    questionText?: string | null;
    messageId?: string | null;
    partId?: string | null;
    timestamp?: number | null;
    partial?: boolean;
    source?: "legacy" | "v2" | "sse";
  }>;
  /** Set when OpenCode is blocked on a question tool waiting for user input. */
  awaitingQuestionText?: string | null;
  eventType?: string;
  partialLiveUpdates?: boolean;
  notes?: string[];
  message?: string;
};

export const CodexActivityItem = type({
  kind: "'message' | 'tool' | 'thinking'",
  text: "string",
  "html?": "string",
  "tool?": "string",
  timestamp: "number | null",
});
export type CodexActivityItem = typeof CodexActivityItem.infer;

export const CodexActivitySnapshot = type({
  items: CodexActivityItem.array(),
  lastTimestamp: "number | null",
  busy: "boolean",
  "status?": "'busy' | 'idle'",
});
export type CodexActivitySnapshot = typeof CodexActivitySnapshot.infer;
export const ExternalCliActivitySnapshot = CodexActivitySnapshot;
export type ExternalCliActivitySnapshot = typeof ExternalCliActivitySnapshot.infer;

export const Capabilities = type({
  "opencodeLocalBase?": "string | null",
  "opencodeTailscaleBase?": "string | null",
  "paseoLocalBase?": "string | null",
  "paseoTailscaleBase?": "string | null",
  "opencodeDirB64?": "string | null",
  "openCodeActivityPreview?": "boolean",
});

export type Capabilities = typeof Capabilities.infer;

export const ErrorPayload = type({
  "error?": "string",
});

export type ErrorPayload = typeof ErrorPayload.infer;

export const WorkspacePathPayload = type({
  path: "string",
  exists: "boolean",
  isDirectory: "boolean",
  writable: "boolean",
  creatable: "boolean",
  parentPath: "string | null",
});

export type WorkspacePathPayload = typeof WorkspacePathPayload.infer;

export const TempWorkspacePathPayload = type({
  path: "string",
  parentPath: "string",
});

export type TempWorkspacePathPayload = typeof TempWorkspacePathPayload.infer;

export const SessionPayload = type({
  session: Session,
});

export type SessionPayload = typeof SessionPayload.infer;

export const CreateOpenCodeSessionPayload = type({
  session: Session,
});

export type CreateOpenCodeSessionPayload = typeof CreateOpenCodeSessionPayload.infer;

export const CliSessionPayload = type({
  session: Session,
});

export type CliSessionPayload = typeof CliSessionPayload.infer;

export const OpenCodeModel = type({
  providerID: "string",
  id: "string",
  name: "string",
  "reasoningEfforts?": "string[]",
});

export type OpenCodeModel = typeof OpenCodeModel.infer;

export const OpenCodeModelsPayload = type({
  models: OpenCodeModel.array(),
});

export type OpenCodeModelsPayload = typeof OpenCodeModelsPayload.infer;

export const NoteRecord = type({
  id: "number",
  sessionId: "string",
  content: "string",
  createdAt: "string",
});

export type NoteRecord = typeof NoteRecord.infer;

export const Routine = type({
  id: "number",
  ownerSessionId: "string",
  status: "'active' | 'paused' | 'firing' | 'fired' | 'cancelled' | 'failed'",
  title: "string | null",
  trigger: {
    kind: "'schedule'",
    dueAt: "number",
    intervalMs: "number | null",
    nextFireAt: "number",
  },
  action: {
    kind: "'deliver_prompt'",
    title: "string",
    message: "string",
  },
  lastFiredAt: "number | null",
  lastMessageId: "number | null",
  lockedAt: "number | null",
  lockedBy: "string | null",
  lastError: "string | null",
  createdAt: "string",
  updatedAt: "string",
});
export type Routine = typeof Routine.infer;
export const RoutinesPayload = type({ routines: Routine.array() });
export type RoutinesPayload = typeof RoutinesPayload.infer;

/** Shape returned by GET /api/sessions/:id/messages */
export const MessagesPayload = type({
  "revision?": "number",
  "session?": Session,
  "messages?": Message.array(),
  "sessions?": Session.array(),
  "lastNoteFirstLine?": "string | null",
  "externalCliActivity?": ExternalCliActivitySnapshot.or("null"),
});

export type MessagesPayload = typeof MessagesPayload.infer;

/** Shape returned by GET /api/sessions/:id/notes */
export const NotesPayload = type({
  "notes?": NoteRecord.array(),
});

export type NotesPayload = typeof NotesPayload.infer;

/** Response from note save/load endpoints */
export const NoteContentPayload = type({
  note: NoteRecord,
});
export type NoteContentPayload = typeof NoteContentPayload.infer;

/** Response from model selection PATCH endpoint */
export const ModelSelectionPayload = type({
  providerID: "string",
  modelID: "string",
  "reasoningEffort?": CodexReasoningEffort.or("null"),
});
export type ModelSelectionPayload = typeof ModelSelectionPayload.infer;

export const SessionOpenCodeReasoningEffortPayload = type({
  available: "string[]",
  selected: "string | null",
  current: "string | null",
});
export type SessionOpenCodeReasoningEffortPayload =
  typeof SessionOpenCodeReasoningEffortPayload.infer;

export const SessionReasoningEffortPayload = type({
  available: CodexReasoningEffort.array(),
  selected: CodexReasoningEffort.or("null"),
  current: CodexReasoningEffort.or("null"),
});
export type SessionReasoningEffortPayload = typeof SessionReasoningEffortPayload.infer;

/** Response from message POST endpoints (returns the created message) */
export const MessageResponsePayload = type({
  message: Message,
});
export type MessageResponsePayload = typeof MessageResponsePayload.infer;

/** Loose schema for OpenCode activity responses (avoid full ArkType rewrite) */
export const OpenCodeActivitySchema = type({
  "type?": "'event' | 'error'",
  "status?":
    "'busy' | 'awaiting-input' | 'idle' | 'pending' | 'retrying' | 'error' | 'missing' | 'unknown' | null",
  "message?": "string",
  "notes?": "string[]",
});
export type OpenCodeActivitySchema = typeof OpenCodeActivitySchema.infer;

/** Organize tree folder shape (matches local OrgFolder in OrganizePage) */
export const OrgFolderSchema = type({
  id: "string",
  name: "string",
  "parentId?": "string | null",
  sortOrder: "number",
});
export type OrgFolder = typeof OrgFolderSchema.infer;

/** Organize tree placement shape */
export const OrgPlacementSchema = type({
  sessionId: "string",
  "folderId?": "string | null",
  sortOrder: "number",
});
export type OrgPlacement = typeof OrgPlacementSchema.infer;

/** Response from /api/session-folders — folders + placements for the organize tree */
export const OrganizeFoldersResponse = type({
  folders: OrgFolderSchema.array(),
  placements: OrgPlacementSchema.array(),
});
export type OrganizeFoldersResponse = typeof OrganizeFoldersResponse.infer;

/** Response from /api/external-cli/session-info */
export const ExternalCliSessionInfo = type({
  "provider?": "string",
  "cwd?": "string | null",
  "ambiguous?": "boolean",
});
export type ExternalCliSessionInfo = typeof ExternalCliSessionInfo.infer;

/** Response from /api/search */
export const SearchResponseSchema = type({
  query: "string",
  sessions: type({
    id: "string",
    "alias?": "string | null",
    "title?": "string | null",
    "cwd?": "string | null",
    state: "string",
    href: "string",
  }).array(),
  messages: type({
    id: "number",
    sessionId: "string",
    text: "string",
    "extraMarkdown?": "string | null",
    "links?": "string[] | null",
    author: "string",
    createdAt: "string",
    "sessionAlias?": "string | null",
    "sessionTitle?": "string | null",
    "sessionCwd?": "string | null",
  }).array(),
});
export type SearchResponseSchema = typeof SearchResponseSchema.infer;
