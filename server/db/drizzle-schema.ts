import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  state: text("state").notNull().default("general"),
  alias: text("alias"),
  revision: integer("revision").notNull().default(0),
  opencodeProjectId: text("opencode_project_id"),
  opencodeWorkspaceId: text("opencode_workspace_id"),
  opencodeDirectory: text("opencode_directory"),
  opencodeWorktree: text("opencode_worktree"),
  opencodePath: text("opencode_path"),
  opencodeProjectName: text("opencode_project_name"),
  opencodeBranch: text("opencode_branch"),
  opencodeSelectedModelProvider: text("opencode_selected_model_provider"),
  opencodeSelectedModel: text("opencode_selected_model"),
  reasoningEffort: text("reasoning_effort"),
  cwd: text("cwd"),
  t3InstanceId: text("t3_instance_id"),
  paseoInstanceId: text("paseo_instance_id"),
});

export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  preferredWorktreeParentPath: text("preferred_worktree_parent_path"),
  preferredJarvisParentPath: text("preferred_jarvis_parent_path"),
  /** JSON array of T3 server instances: { id, binPath, baseDir, originUrl }[] */
  t3ServerInstances: text("t3_server_instances").notNull().default("[]"),
  /** JSON array of Paseo instances: { id, binPath?, home?, host }[] */
  paseoInstances: text("paseo_instances").notNull().default("[]"),
  /** JSON array of OpenCode instances: { id, localUrl?, tailscaleUrl? }[] */
  opencodeInstances: text("opencode_instances").notNull().default("[]"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const spaces = sqliteTable(
  "spaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    archived: integer("archived").notNull().default(0),
    context: text("context").notNull().default(""),
    defaultProvider: text("default_provider"),
    defaultModel: text("default_model"),
    access: text("access").notNull().default("private"),
    sortOrder: real("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("spaces_parent_sort_idx").on(table.parentId, table.sortOrder)],
);

export const repositories = sqliteTable(
  "repositories",
  {
    id: text("id").primaryKey(),
    identity: text("identity").notNull().unique(),
    name: text("name").notNull(),
    rootPath: text("root_path").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("repositories_root_path_idx").on(table.rootPath)],
);

export const worktrees = sqliteTable(
  "worktrees",
  {
    id: text("id").primaryKey(),
    path: text("path").notNull().unique(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    branch: text("branch").notNull(),
    isMain: integer("is_main").notNull().default(0),
    discoveredAt: text("discovered_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("worktrees_repository_idx").on(table.repositoryId)],
);

export const spaceRepositories = sqliteTable(
  "space_repositories",
  {
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    sortOrder: real("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("space_repositories_unique").on(table.spaceId, table.repositoryId),
    index("space_repositories_space_idx").on(table.spaceId, table.sortOrder),
  ],
);

export const spaceWorktrees = sqliteTable(
  "space_worktrees",
  {
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    worktreeId: text("worktree_id")
      .notNull()
      .references(() => worktrees.id, { onDelete: "cascade" }),
    importedAt: text("imported_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("space_worktrees_unique").on(table.spaceId, table.worktreeId),
    index("space_worktrees_space_idx").on(table.spaceId),
  ],
);

export const spaceSessions = sqliteTable(
  "space_sessions",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    importedAt: text("imported_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("space_sessions_space_idx").on(table.spaceId)],
);

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull().default("default"),
  text: text("text").notNull(),
  extraMarkdown: text("extra_markdown"),
  pushNotificationText: text("push_notification_text"),
  status: text("status").notNull().default("queued"),
  pinned: integer("pinned").notNull().default(0),
  author: text("author").notNull().default("agent"),
  parentId: integer("parent_id"),
  attachedSessionId: text("attached_session_id"),
  opencodeDeliveryStatus: text("opencode_delivery_status"),
  opencodeDeliveryError: text("opencode_delivery_error"),
  opencodeMessageId: text("opencode_message_id"),
  clientMessageId: text("client_message_id"),
  links: text("links"),
  sessionRefs: text("session_refs"),
  mergedIntoMessageId: integer("merged_into_message_id"),
  forwardRole: text("forward_role"),
  forwardSourceSessionId: text("forward_source_session_id"),
  forwardSourceMessageId: integer("forward_source_message_id"),
  forwardTargetSessionId: text("forward_target_session_id"),
  forwardTargetMessageId: integer("forward_target_message_id"),
  forwardStatus: text("forward_status"),
  completionWatchStatus: text("completion_watch_status"),
  completionWatchWorkSeen: integer("completion_watch_work_seen").notNull().default(0),
  completionWatchNextCheckAt: integer("completion_watch_next_check_at").notNull().default(0),
  completionSourceSessionId: text("completion_source_session_id"),
  completionSourceMessageId: integer("completion_source_message_id"),
  completionTargetNotificationMessageId: integer("completion_target_notification_message_id"),
  completionSourceNotificationMessageId: integer("completion_source_notification_message_id"),
  paseoAuthor: text("paseo_author"),
  paseoAuthorName: text("paseo_author_name"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const sessionNotes = sqliteTable("session_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Session organization tree (the /organize feature). Folders form an adjacency
// list; a session's placement lives in a separate table keyed by session_id
// with NO FK to sessions, so — like session_notes — the organization survives
// a session being deleted (the UI just hides placements for missing sessions).
export const sessionFolders = sqliteTable(
  "session_folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    sortOrder: real("sort_order").notNull().default(0),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("session_folders_parent_idx").on(table.parentId, table.sortOrder)],
);

export const sessionPlacements = sqliteTable(
  "session_placements",
  {
    sessionId: text("session_id").primaryKey(),
    folderId: text("folder_id"),
    sortOrder: real("sort_order").notNull().default(0),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("session_placements_folder_idx").on(table.folderId, table.sortOrder)],
);

export const messageAttachments = sqliteTable("message_attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messageId: integer("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  thumbnailDataUrl: text("thumbnail_data_url").notNull().default(""),
  thumbnailWidth: integer("thumbnail_width").notNull().default(0),
  thumbnailHeight: integer("thumbnail_height").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    sessionTitle: text("session_title").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    url: text("url").notNull(),
    dismissedAt: text("dismissed_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("notifications_created_at_idx").on(table.createdAt)],
);

export const opencodeDeliveryJobs = sqliteTable(
  "opencode_delivery_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    messageSessionId: text("message_session_id").notNull(),
    opencodeSessionId: text("opencode_session_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    useCli: integer("use_cli").notNull().default(0),
    force: integer("force").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    opencodeMessageId: text("opencode_message_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("opencode_delivery_jobs_message_kind_unique").on(table.messageId, table.kind),
    index("opencode_delivery_jobs_due_idx").on(table.status, table.nextAttemptAt),
    index("opencode_delivery_jobs_opencode_session_idx").on(
      table.opencodeSessionId,
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const t3DeliveryJobs = sqliteTable(
  "t3_delivery_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    messageSessionId: text("message_session_id").notNull(),
    t3SessionId: text("t3_session_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    sequence: integer("sequence"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("t3_delivery_jobs_message_kind_unique").on(table.messageId, table.kind),
    index("t3_delivery_jobs_due_idx").on(table.status, table.nextAttemptAt),
    index("t3_delivery_jobs_session_idx").on(table.t3SessionId, table.status, table.nextAttemptAt),
  ],
);

export const paseoDeliveryJobs = sqliteTable(
  "paseo_delivery_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    messageSessionId: text("message_session_id").notNull(),
    paseoSessionId: text("paseo_session_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("paseo_delivery_jobs_message_kind_unique").on(table.messageId, table.kind),
    index("paseo_delivery_jobs_due_idx").on(table.status, table.nextAttemptAt),
    index("paseo_delivery_jobs_session_idx").on(
      table.paseoSessionId,
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const cursorDeliveryJobs = sqliteTable(
  "cursor_delivery_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    messageSessionId: text("message_session_id").notNull(),
    cursorSessionId: text("cursor_session_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    /**
     * Durable globally unique dispatch identity (`<backend>-<uuid>`), set at enqueue.
     * Accept-marker paths/keys use this so provider-local job ids and DB resets cannot collide.
     */
    dispatchKey: text("dispatch_key").notNull().default(""),
    /** Set when the provider prompt is spawned/accepted; blocks re-prompt on reclaim. */
    promptDispatchedAt: integer("prompt_dispatched_at"),
    /**
     * Set when the worker observes the CLI turn actually end. Independent of
     * job status: a succeeded/failed/expired job can still have an open turn.
     */
    cliTurnEndedAt: integer("cli_turn_ended_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("cursor_delivery_jobs_message_kind_unique").on(table.messageId, table.kind),
    index("cursor_delivery_jobs_due_idx").on(table.status, table.nextAttemptAt),
    index("cursor_delivery_jobs_session_idx").on(
      table.cursorSessionId,
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const claudeDeliveryJobs = sqliteTable(
  "claude_delivery_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    messageSessionId: text("message_session_id").notNull(),
    claudeSessionId: text("claude_session_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    /**
     * Durable globally unique dispatch identity (`<backend>-<uuid>`), set at enqueue.
     * Accept-marker paths/keys use this so provider-local job ids and DB resets cannot collide.
     */
    dispatchKey: text("dispatch_key").notNull().default(""),
    /** Set when the provider prompt is spawned/accepted; blocks re-prompt on reclaim. */
    promptDispatchedAt: integer("prompt_dispatched_at"),
    /**
     * Set when the worker observes the CLI turn actually end. Independent of
     * job status: a succeeded/failed/expired job can still have an open turn.
     */
    cliTurnEndedAt: integer("cli_turn_ended_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("claude_delivery_jobs_message_kind_unique").on(table.messageId, table.kind),
    index("claude_delivery_jobs_due_idx").on(table.status, table.nextAttemptAt),
    index("claude_delivery_jobs_session_idx").on(
      table.claudeSessionId,
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const codexDeliveryJobs = sqliteTable(
  "codex_delivery_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    messageSessionId: text("message_session_id").notNull(),
    codexSessionId: text("codex_session_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    /**
     * Durable globally unique dispatch identity (`<backend>-<uuid>`), set at enqueue.
     * Accept-marker paths/keys use this so provider-local job ids and DB resets cannot collide.
     */
    dispatchKey: text("dispatch_key").notNull().default(""),
    /** Set when the provider prompt is spawned/accepted; blocks re-prompt on reclaim. */
    promptDispatchedAt: integer("prompt_dispatched_at"),
    /** Set when the worker observes the CLI turn actually end; independent of job status. */
    cliTurnEndedAt: integer("cli_turn_ended_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("codex_delivery_jobs_message_kind_unique").on(table.messageId, table.kind),
    index("codex_delivery_jobs_due_idx").on(table.status, table.nextAttemptAt),
    index("codex_delivery_jobs_session_idx").on(
      table.codexSessionId,
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

export const grokDeliveryJobs = sqliteTable(
  "grok_delivery_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    messageSessionId: text("message_session_id").notNull(),
    grokSessionId: text("grok_session_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    /**
     * Durable globally unique dispatch identity (`<backend>-<uuid>`), set at enqueue.
     * Accept-marker paths/keys use this so provider-local job ids and DB resets cannot collide.
     */
    dispatchKey: text("dispatch_key").notNull().default(""),
    /** Set when the provider prompt is spawned/accepted; blocks re-prompt on reclaim. */
    promptDispatchedAt: integer("prompt_dispatched_at"),
    /** Set when the worker observes the CLI turn actually end; independent of job status. */
    cliTurnEndedAt: integer("cli_turn_ended_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("grok_delivery_jobs_message_kind_unique").on(table.messageId, table.kind),
    index("grok_delivery_jobs_due_idx").on(table.status, table.nextAttemptAt),
    index("grok_delivery_jobs_session_idx").on(
      table.grokSessionId,
      table.status,
      table.nextAttemptAt,
    ),
  ],
);

/**
 * Durable automation rules (schedule today; session_idle in Phase 2).
 * `trigger` / `action` are JSON; `trigger_kind` + `next_fire_at` support worker indexes.
 */
export const routines = sqliteTable(
  "routines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerSessionId: text("owner_session_id").notNull(),
    status: text("status").notNull().default("active"),
    title: text("title"),
    triggerKind: text("trigger_kind").notNull(),
    trigger: text("trigger").notNull(),
    action: text("action").notNull(),
    /** Denormalized schedule scan key; null for non-schedule triggers. */
    nextFireAt: integer("next_fire_at"),
    lastFiredAt: integer("last_fired_at"),
    lastMessageId: integer("last_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    lockedAt: integer("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("routines_owner_status_idx").on(table.ownerSessionId, table.status, table.nextFireAt),
    index("routines_due_idx").on(table.status, table.nextFireAt),
    index("routines_trigger_kind_idx").on(table.triggerKind, table.status),
  ],
);

/**
 * Server-owned Jarvis create operations.
 * Unique on workspaceIdentity (canonical path) so one physical folder has one operation globally.
 * Crash window: after provider session creation and before sessionId is persisted —
 * resume never invents a session from cwd; only operation.sessionId is authoritative.
 * createdWorkspace marks dirs this operation created (safe to compensate); resumed dirs must never be rm -rf'd.
 */
export const jarvisCreateOperations = sqliteTable(
  "jarvis_create_operations",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    workspaceIdentity: text("workspace_identity").notNull(),
    workspaceDirectory: text("workspace_directory").notNull(),
    alias: text("alias").notNull(),
    slug: text("slug").notNull(),
    provider: text("provider").notNull(),
    providerConfigFingerprint: text("provider_config_fingerprint").notNull(),
    modelId: text("model_id"),
    reasoningEffort: text("reasoning_effort"),
    phase: text("phase").notNull().default("pending"),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    createdWorkspace: integer("created_workspace").notNull().default(0),
    createdAttachment: integer("created_attachment").notNull().default(0),
    providerCreateComplete: integer("provider_create_complete").notNull().default(0),
    leasedAt: integer("leased_at"),
    leaseOwner: text("lease_owner"),
    bootstrapClientMessageId: text("bootstrap_client_message_id"),
    bootstrapStatus: text("bootstrap_status"),
    bootstrapError: text("bootstrap_error"),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("jarvis_create_operations_workspace_uidx").on(table.workspaceIdentity),
    uniqueIndex("jarvis_create_operations_space_alias_uidx").on(table.spaceId, table.alias),
    index("jarvis_create_operations_session_idx").on(table.sessionId),
    index("jarvis_create_operations_space_idx").on(table.spaceId),
  ],
);
