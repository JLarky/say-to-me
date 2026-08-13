import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { Cause, Duration, Effect, Exit, Fiber } from "effect";
import {
  isCodexReasoningEffort,
  type CodexReasoningEffort,
} from "../src/codex-reasoning-effort.ts";
import { broadcastQueue, broadcastSessions } from "./broadcast.ts";
import { drizzleDb, drizzleSqlite } from "./db/index.ts";
import { jarvisCreateOperations, spaces } from "./db/drizzle-schema.ts";
import { DbJarvisCreateOperation, validateDb } from "./db/schemas.ts";
import { createCliSessionRecord } from "./external-cli/create-cli-session.ts";
import { prefixedUuidSessionId, stripPrefixedUuid } from "./external-cli/prefixed-session.ts";
import type { ExternalCliBackend } from "./external-cli/session-backend.ts";
import {
  recordJarvisSessionArtifact,
  readJarvisBootstrapMessage,
  removeJarvisWorkspaceDirectory,
  resolveJarvisWorkspacePath,
  stageJarvisWorkspaceAt,
} from "./jarvis-template.ts";
import { getMessage, getMessageByClientId, insertMessageRow } from "./messages.ts";
import {
  addOpenCodeStatus,
  createOpenCodeSession,
  listOpenCodeModels,
  listOpenCodeSessionsForDirectory,
  setOpenCodeSessionModel,
  updateOpenCodeTitle,
} from "./opencode/client.ts";
import { getAppSettings } from "./settings.ts";
import { CLAUDE_SESSION, CURSOR_SESSION, detectSessionBackend } from "./session-id.ts";
import {
  ensureSession,
  getSession,
  getSessionByAlias,
  setSessionAliasIfSafe,
  updateSessionModelAndReasoningEffort,
  updateSessionState,
} from "./sessions.ts";
import { applySpaceAction, spaceState, spaceStateNow } from "./spaces.ts";
import { enqueueSourceCompletionNotice } from "./external-cli/session-work-status.ts";
import { enqueueOpenCodeDeliveryJob } from "./opencode/durable-delivery.ts";

const execFileAsync = promisify(execFile);

export type JarvisCreateProvider = "opencode" | ExternalCliBackend;

export type JarvisCreatePhase =
  | "pending"
  | "staging"
  | "git_init"
  | "attaching"
  | "creating_session"
  | "claiming"
  | "bootstrapping"
  | "completed"
  | "failed"
  | "invalidated";

export type JarvisBootstrapStatus = "delivered" | "queued" | "failed";

export type JarvisCreateDeps = {
  createOpenCodeSession?: typeof createOpenCodeSession;
  createCliSessionRecord?: typeof createCliSessionRecord;
  listOpenCodeSessionsForDirectory?: typeof listOpenCodeSessionsForDirectory;
  listOpenCodeModels?: typeof listOpenCodeModels;
  setOpenCodeSessionModel?: typeof setOpenCodeSessionModel;
  /** Test hook: before provider create / before remote title or local marker exists. */
  crashBeforeProviderMarker?: () => void;
  /**
   * Test hook: Codex/Grok only — after remote bootstrap returns, before ensureSession.
   * Documents the remote-orphan window (no exact-once recovery claimed).
   */
  crashAfterProviderBootstrapBeforeLocalSession?: (sessionId: string) => void;
  /** Test hook: after provider returns an id, before local marker (OpenCode title may already exist). */
  crashAfterProviderCreateBeforeMarker?: (sessionId: string) => void;
  /** Test hook: after marker, before operation.sessionId persist. */
  crashAfterProviderCreateBeforePersist?: (sessionId: string) => void;
  /** Test hook: after compensation CAS-clears flags, before releaseRepository. */
  crashAfterCompensationClaim?: () => void;
  /** Test hook: after releaseRepository, before workspace rm. */
  crashAfterCompensationRelease?: () => void;
  /** Test hook: after workspace rm during compensation. */
  crashAfterCompensationWorkspaceRm?: () => void;
  /** Test hook: after createdWorkspace ownership persist, before mkdir/materialize. */
  crashAfterStagingOwnership?: () => void;
  /** Test hook: after mkdir, before template materialize. */
  crashAfterStagingMkdirBeforeMaterialize?: () => void;
  /** Test hook: during template copy after the first file is written. */
  crashDuringStagingMaterialize?: () => void;
  /** Test hook: after template materialize, before createdWorkspace would previously have been set. */
  crashAfterStagingMaterialize?: () => void;
  /** Test hook: after attachRepository returns, before createdAttachment persist. */
  crashAfterAttachBeforeCreatedAttachment?: () => void;
  /** Test hook: override lease TTL (ms). */
  leaseTtlMs?: number;
  /**
   * Test hook: throw from lease DB helpers before the SQLite call.
   * Use to prove acquire/renew/release/heartbeat surface `JarvisCreateError` instead of Cause.Die.
   * `"heartbeat"` only fires in the lease heartbeat fiber (not `requireLease` renewals).
   */
  throwFromLeaseDb?:
    | "acquire"
    | "renew"
    | "release"
    | "heartbeat"
    | ((op: "acquire" | "renew" | "release" | "heartbeat") => void);
};

let jarvisCreateDeps: JarvisCreateDeps = {};

export function setJarvisCreateDepsForTest(deps: JarvisCreateDeps): void {
  jarvisCreateDeps = deps;
}

export function resetJarvisCreateDepsForTest(): void {
  jarvisCreateDeps = {};
}

export type CreateJarvisInSpaceInput = {
  spaceId: string;
  name: string;
  provider: JarvisCreateProvider;
  modelID?: string;
  reasoningEffort?: CodexReasoningEffort | "";
};

export type CreateJarvisInSpaceResult = {
  state: ReturnType<typeof spaceState>;
  session: Awaited<ReturnType<typeof ensureSession>>;
  workspaceDirectory: string;
  bootstrapStatus: JarvisBootstrapStatus;
  bootstrapError?: string;
  resumed: boolean;
};

export class JarvisCreateError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Thrown when this process no longer owns the operation lease — never compensate after this. */
export class JarvisLeaseLostError extends JarvisCreateError {
  constructor() {
    super("Lost Jarvis create lease to another process.", 409);
  }
}

const JARVIS_GIT_NAME = "Say To Me";
const JARVIS_GIT_EMAIL = "jarvis@say-to-me.local";
const DEFAULT_LEASE_TTL_MS = 60_000;

function leaseTtlMs(): number {
  return jarvisCreateDeps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
}

/** Stable operation marker used for provider-session reconciliation (never cwd alone). */
export function jarvisOperationBindMarker(operationId: string): string {
  return `jarvis-op:${operationId}`;
}

/** In-process locks so concurrent POSTs for the same space+alias serialize in one process. */
const operationLocks = new Map<string, Promise<unknown>>();

export function providerConfigFingerprint(input: {
  provider: JarvisCreateProvider;
  modelID?: string;
  reasoningEffort?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: input.provider,
        modelID: input.modelID?.trim() || null,
        reasoningEffort: input.reasoningEffort?.trim() || null,
      }),
    )
    .digest("hex");
}

function statusFromUnknownError(error: unknown): number {
  if (error instanceof JarvisCreateError) return error.status;
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return 500;
}

async function gitWithIdentity(directory: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: JARVIS_GIT_NAME,
      GIT_AUTHOR_EMAIL: JARVIS_GIT_EMAIL,
      GIT_COMMITTER_NAME: JARVIS_GIT_NAME,
      GIT_COMMITTER_EMAIL: JARVIS_GIT_EMAIL,
    },
  });
  return result.stdout.trim();
}

export async function initializeJarvisGitRepo(workspaceDirectory: string): Promise<void> {
  const gitDir = path.join(workspaceDirectory, ".git");
  if (!existsSync(gitDir)) {
    await execFileAsync("git", ["-C", workspaceDirectory, "init", "-q", "-b", "main"]);
  }
  await gitWithIdentity(workspaceDirectory, ["add", "-A"]);
  const status = await gitWithIdentity(workspaceDirectory, ["status", "--porcelain"]);
  if (status) {
    await gitWithIdentity(workspaceDirectory, [
      "commit",
      "-q",
      "-m",
      "Initialize Jarvis workspace",
    ]);
  }
  await gitWithIdentity(workspaceDirectory, ["checkout", "-B", "main"]).catch(async () => {
    await gitWithIdentity(workspaceDirectory, ["branch", "-M", "main"]);
  });
}

export async function validateJarvisGitRepo(workspaceDirectory: string): Promise<void> {
  const gitDir = path.join(workspaceDirectory, ".git");
  if (!existsSync(gitDir)) {
    throw new JarvisCreateError("Resumed Jarvis workspace is missing .git.", 409);
  }
  try {
    await execFileAsync("git", ["-C", workspaceDirectory, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
    });
  } catch {
    throw new JarvisCreateError("Resumed Jarvis workspace is not a valid git repository.", 409);
  }
}

/** Commit workspace changes with the Jarvis identity — only for operation-owned new repos. */
export async function commitJarvisWorkspaceChanges(
  workspaceDirectory: string,
  message: string,
): Promise<void> {
  await gitWithIdentity(workspaceDirectory, ["add", "-A"]);
  const status = await gitWithIdentity(workspaceDirectory, ["status", "--porcelain"]);
  if (!status) return;
  await gitWithIdentity(workspaceDirectory, ["commit", "-q", "-m", message]);
}

function requireSpace(spaceId: string) {
  const space = drizzleDb.select().from(spaces).where(eq(spaces.id, spaceId)).get();
  if (!space || space.archived) throw new JarvisCreateError("Space not found.", 404);
  return space;
}

function validateOperation(row: unknown, context: string): DbJarvisCreateOperation {
  return validateDb(DbJarvisCreateOperation, row, context);
}

function getOperationByWorkspace(workspaceIdentity: string) {
  const row = drizzleDb
    .select()
    .from(jarvisCreateOperations)
    .where(eq(jarvisCreateOperations.workspaceIdentity, workspaceIdentity))
    .get();
  return row ? validateOperation(row, "getOperationByWorkspace") : undefined;
}

function getOperationBySpaceAlias(spaceId: string, alias: string) {
  const row = drizzleDb
    .select()
    .from(jarvisCreateOperations)
    .where(
      and(eq(jarvisCreateOperations.spaceId, spaceId), eq(jarvisCreateOperations.alias, alias)),
    )
    .get();
  return row ? validateOperation(row, "getOperationBySpaceAlias") : undefined;
}

function getOperationById(id: string) {
  const row = drizzleDb
    .select()
    .from(jarvisCreateOperations)
    .where(eq(jarvisCreateOperations.id, id))
    .get();
  return row ? validateOperation(row, "getOperationById") : undefined;
}

type OperationPatch = Partial<{
  phase: JarvisCreatePhase;
  sessionId: string | null;
  createdWorkspace: number;
  createdAttachment: number;
  providerCreateComplete: number;
  bootstrapClientMessageId: string | null;
  bootstrapStatus: JarvisBootstrapStatus | null;
  bootstrapError: string | null;
  error: string | null;
  workspaceDirectory: string;
}>;

function maybeThrowFromLeaseDb(op: "acquire" | "renew" | "release" | "heartbeat"): void {
  const hook = jarvisCreateDeps.throwFromLeaseDb;
  if (!hook) return;
  if (typeof hook === "function") {
    hook(op);
    return;
  }
  if (hook === op) {
    throw new Error(`simulated lease ${op} DB failure`);
  }
}

/** Cross-process lease via compare-and-set on lease_owner / leased_at. */
export function tryAcquireJarvisCreateLease(operationId: string, owner: string): boolean {
  maybeThrowFromLeaseDb("acquire");
  const now = Date.now();
  const staleBefore = now - leaseTtlMs();
  const result = drizzleSqlite
    .prepare(
      `UPDATE jarvis_create_operations
       SET lease_owner = ?, leased_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND (
           lease_owner IS NULL
           OR lease_owner = ?
           OR leased_at IS NULL
           OR leased_at < ?
         )`,
    )
    .run(owner, now, operationId, owner, staleBefore);
  return result.changes === 1;
}

export function renewJarvisCreateLease(operationId: string, owner: string): boolean {
  maybeThrowFromLeaseDb("renew");
  const now = Date.now();
  const result = drizzleSqlite
    .prepare(
      `UPDATE jarvis_create_operations
       SET leased_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND lease_owner = ?`,
    )
    .run(now, operationId, owner);
  return result.changes === 1;
}

export function ownsJarvisCreateLease(operationId: string, owner: string): boolean {
  const row = getOperationById(operationId);
  return row?.leaseOwner === owner;
}

export function releaseJarvisCreateLease(operationId: string, owner: string): void {
  maybeThrowFromLeaseDb("release");
  drizzleSqlite
    .prepare(
      `UPDATE jarvis_create_operations
       SET lease_owner = NULL, leased_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND lease_owner = ?`,
    )
    .run(operationId, owner);
}

function leaseHeartbeatPeriodMs(): number {
  return Math.max(25, Math.min(Math.floor(leaseTtlMs() / 3), 5_000));
}

/** Map sync SQLite throws into typed route errors (never Cause.Die). */
function tryLeaseDb<A>(try_: () => A): Effect.Effect<A, JarvisCreateError> {
  return Effect.try({
    try: try_,
    catch: (cause) =>
      cause instanceof JarvisCreateError
        ? cause
        : new JarvisCreateError(cause instanceof Error ? cause.message : String(cause), 500),
  });
}

/** Retry lease acquisition with Effect sleep (Clock / TestClock aware). */
function acquireJarvisCreateLeaseEffect(
  operationId: string,
  owner: string,
): Effect.Effect<boolean, JarvisCreateError> {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (yield* tryLeaseDb(() => tryAcquireJarvisCreateLease(operationId, owner))) return true;
      yield* Effect.sleep(Duration.millis(25));
    }
    return false;
  });
}

/**
 * Forever renew loop; stops when renewal fails (theft / expiry) or DB errors.
 * Lease DB work is Effect.try-wrapped so SQLite throws are Fail, not Die —
 * catchAll can then end the fiber cleanly (catchAll does not catch defects).
 */
function jarvisCreateLeaseHeartbeatEffect(operationId: string, owner: string): Effect.Effect<void> {
  const period = leaseHeartbeatPeriodMs();
  return Effect.gen(function* () {
    yield* Effect.sleep(Duration.millis(period));
    const renewed = yield* tryLeaseDb(() => {
      maybeThrowFromLeaseDb("heartbeat");
      return renewJarvisCreateLease(operationId, owner);
    });
    if (!renewed) {
      return yield* Effect.fail(new JarvisLeaseLostError());
    }
  }).pipe(
    Effect.forever,
    Effect.catchAll(() => Effect.void),
  );
}

/** Exported for deterministic heartbeat Fail-vs-Die regressions. */
export function jarvisCreateLeaseHeartbeatEffectForTest(
  operationId: string,
  owner: string,
): Effect.Effect<void> {
  return jarvisCreateLeaseHeartbeatEffect(operationId, owner);
}

/**
 * Acquire the durable DB lease, run work under a forked heartbeat fiber, and
 * always interrupt heartbeat then release. Release is Effect.try-wrapped so SQLite
 * throws become JarvisCreateError (ensuring cannot carry Fail — use Exit).
 */
export function withJarvisCreateLeaseEffect<A, E>(
  operationId: string,
  owner: string,
  work: Effect.Effect<A, E>,
): Effect.Effect<A, E | JarvisCreateError> {
  return Effect.gen(function* () {
    const leased = yield* acquireJarvisCreateLeaseEffect(operationId, owner);
    if (!leased) {
      return yield* Effect.fail(
        new JarvisCreateError("Jarvis create operation is busy. Retry shortly.", 409),
      );
    }
    const heartbeat = yield* Effect.fork(jarvisCreateLeaseHeartbeatEffect(operationId, owner));
    const exit = yield* Effect.exit(work);
    yield* Fiber.interrupt(heartbeat);
    // Prefer a typed release failure over a successful work result (lease must not stick silently).
    yield* tryLeaseDb(() => {
      releaseJarvisCreateLease(operationId, owner);
    });
    return yield* Exit.matchEffect(exit, {
      onFailure: (cause) => Effect.failCause(cause),
      onSuccess: (value) => Effect.succeed(value),
    });
  });
}

/** Every mutation of the operation row must be CAS-guarded by the current lease owner. */
export function updateOperationWithLease(id: string, owner: string, patch: OperationPatch): void {
  const now = Date.now();
  const sets: string[] = ["leased_at = ?", "updated_at = CURRENT_TIMESTAMP"];
  const values: unknown[] = [now];

  const columnMap: Record<keyof OperationPatch, string> = {
    phase: "phase",
    sessionId: "session_id",
    createdWorkspace: "created_workspace",
    createdAttachment: "created_attachment",
    providerCreateComplete: "provider_create_complete",
    bootstrapClientMessageId: "bootstrap_client_message_id",
    bootstrapStatus: "bootstrap_status",
    bootstrapError: "bootstrap_error",
    error: "error",
    workspaceDirectory: "workspace_directory",
  };

  for (const [key, column] of Object.entries(columnMap) as Array<[keyof OperationPatch, string]>) {
    if (key in patch) {
      sets.push(`${column} = ?`);
      values.push(patch[key] ?? null);
    }
  }

  values.push(id, owner);
  const result = drizzleSqlite
    .prepare(
      `UPDATE jarvis_create_operations SET ${sets.join(", ")} WHERE id = ? AND lease_owner = ?`,
    )
    .run(...values);
  if (result.changes !== 1) throw new JarvisLeaseLostError();
}

function requireLease(operationId: string, owner: string): void {
  if (!renewJarvisCreateLease(operationId, owner)) throw new JarvisLeaseLostError();
}

function enqueueJarvisBootstrap(sessionId: string, messageId: number): void {
  const backend = detectSessionBackend(sessionId);
  if (backend === "opencode" || !backend) {
    enqueueOpenCodeDeliveryJob({
      messageId,
      messageSessionId: sessionId,
      opencodeSessionId: sessionId,
      kind: "direct_user_message",
    });
    return;
  }
  enqueueSourceCompletionNotice({
    messageId,
    messageSessionId: sessionId,
    sessionId,
  });
}

function canPreallocateSessionId(provider: JarvisCreateProvider): provider is "claude" | "cursor" {
  return provider === "claude" || provider === "cursor";
}

function applyBindMarker(sessionId: string, marker: string): void {
  setSessionAliasIfSafe(sessionId, marker);
}

async function reconcileProviderSessionIfNeeded(input: {
  operationId: string;
  leaseOwner: string;
  workspaceDirectory: string;
  sessionId: string | null;
  provider: string;
  providerCreateComplete: number;
}): Promise<string | null> {
  if (input.sessionId) return input.sessionId;
  const marker = jarvisOperationBindMarker(input.operationId);

  const byAlias = getSessionByAlias(marker);
  if (byAlias) {
    updateOperationWithLease(input.operationId, input.leaseOwner, {
      sessionId: byAlias.id,
      phase: "creating_session",
    });
    return byAlias.id;
  }

  if (input.provider !== "opencode") return null;

  const list =
    jarvisCreateDeps.listOpenCodeSessionsForDirectory ?? listOpenCodeSessionsForDirectory;
  const sessions = await list(input.workspaceDirectory);
  const marked = sessions.find((session) => session.title === marker);
  if (!marked) return null;
  updateOperationWithLease(input.operationId, input.leaseOwner, {
    sessionId: marked.id,
    phase: "creating_session",
    providerCreateComplete: 1,
  });
  ensureSession(marked.id);
  applyBindMarker(marked.id, marker);
  return marked.id;
}

async function repairIncompletePreallocatedSession(input: {
  operationId: string;
  leaseOwner: string;
  provider: "claude" | "cursor";
  sessionId: string;
  workspaceDirectory: string;
  modelID?: string;
}): Promise<void> {
  const modelID = input.modelID?.trim();
  if (!modelID) throw new JarvisCreateError("Pick a model first.", 400);
  const prefix = input.provider === "claude" ? CLAUDE_SESSION : CURSOR_SESSION;
  const rawUuid = stripPrefixedUuid(prefix.prefix, input.sessionId);
  const createCli = jarvisCreateDeps.createCliSessionRecord ?? createCliSessionRecord;
  requireLease(input.operationId, input.leaseOwner);
  await createCli(input.provider, input.workspaceDirectory, modelID, {}, undefined, {
    preallocatedRawUuid: rawUuid,
    bindMarker: jarvisOperationBindMarker(input.operationId),
  });
  updateOperationWithLease(input.operationId, input.leaseOwner, { providerCreateComplete: 1 });
}

function parseOpenCodeModelSelection(
  modelID: string | undefined,
): { providerID: string; modelID: string } | null {
  const trimmed = modelID?.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  return {
    providerID: trimmed.slice(0, slash).trim(),
    modelID: trimmed.slice(slash + 1).trim(),
  };
}

async function applyOpenCodeModelBeforeBootstrap(input: {
  sessionId: string;
  workspaceDirectory: string;
  modelID?: string;
}): Promise<void> {
  const selected = parseOpenCodeModelSelection(input.modelID);
  if (!selected) throw new JarvisCreateError("Pick an OpenCode model (provider/model).", 400);

  let available: Awaited<ReturnType<typeof listOpenCodeModels>> = [];
  const listModels = jarvisCreateDeps.listOpenCodeModels ?? listOpenCodeModels;
  const setModel = jarvisCreateDeps.setOpenCodeSessionModel ?? setOpenCodeSessionModel;
  try {
    available = await listModels(input.workspaceDirectory);
  } catch {
    // Fall back to global OpenCode config if workspace providers are unreachable.
    available = await listModels();
  }
  const match = available.find(
    (model) => model.providerID === selected.providerID && model.id === selected.modelID,
  );
  if (!match) {
    throw new JarvisCreateError(
      `OpenCode model ${selected.providerID}/${selected.modelID} is not available for this workspace.`,
      400,
    );
  }

  try {
    await setModel(
      input.sessionId,
      selected.providerID,
      selected.modelID,
      input.workspaceDirectory,
    );
  } catch (error) {
    throw new JarvisCreateError(
      error instanceof Error
        ? error.message
        : "Unable to set OpenCode session model before bootstrap.",
      502,
    );
  }
  updateSessionModelAndReasoningEffort(
    input.sessionId,
    selected.providerID,
    selected.modelID,
    null,
  );
}

async function createAndBindProviderSession(input: {
  operationId: string;
  leaseOwner: string;
  provider: JarvisCreateProvider;
  workspaceDirectory: string;
  alias: string;
  modelID?: string;
  reasoningEffort?: CodexReasoningEffort | "";
}): Promise<string> {
  const createOpenCode = jarvisCreateDeps.createOpenCodeSession ?? createOpenCodeSession;
  const createCli = jarvisCreateDeps.createCliSessionRecord ?? createCliSessionRecord;
  const crashBefore = jarvisCreateDeps.crashBeforeProviderMarker;
  const crashAfterBootstrap = jarvisCreateDeps.crashAfterProviderBootstrapBeforeLocalSession;
  const crashBeforeMarker = jarvisCreateDeps.crashAfterProviderCreateBeforeMarker;
  const crashBeforePersist = jarvisCreateDeps.crashAfterProviderCreateBeforePersist;
  const marker = jarvisOperationBindMarker(input.operationId);

  requireLease(input.operationId, input.leaseOwner);

  if (canPreallocateSessionId(input.provider)) {
    const provider = input.provider;
    const prefix = provider === "claude" ? CLAUDE_SESSION : CURSOR_SESSION;
    const rawUuid = randomUUID();
    const sessionId = prefixedUuidSessionId(prefix, rawUuid);
    if (!sessionId) throw new JarvisCreateError("Unable to allocate Jarvis session id.", 500);
    // Local row must exist before the operation FK can reference session_id.
    ensureSession(sessionId);
    updateOperationWithLease(input.operationId, input.leaseOwner, {
      sessionId,
      phase: "creating_session",
      providerCreateComplete: 0,
    });
    applyBindMarker(sessionId, marker);
    const modelID = input.modelID?.trim();
    if (!modelID) throw new JarvisCreateError("Pick a model first.", 400);
    crashBefore?.();
    await createCli(provider, input.workspaceDirectory, modelID, {}, undefined, {
      preallocatedRawUuid: rawUuid,
      bindMarker: marker,
      crashAfterBootstrapBeforeEnsureSession: crashAfterBootstrap,
      crashAfterCreateBeforeMarker: crashBeforeMarker,
    });
    updateOperationWithLease(input.operationId, input.leaseOwner, { providerCreateComplete: 1 });
    return sessionId;
  }

  updateOperationWithLease(input.operationId, input.leaseOwner, { phase: "creating_session" });

  if (input.provider === "opencode") {
    crashBefore?.();
    // Pass marker as create-time title so a crash before local writes is still recoverable.
    const created = await createOpenCode(input.workspaceDirectory, { title: marker });
    if (!created.ok) {
      throw new JarvisCreateError(
        created.error || "Unable to create OpenCode session.",
        created.status,
      );
    }
    const sessionId = created.session.id;
    await applyOpenCodeModelBeforeBootstrap({
      sessionId,
      workspaceDirectory: input.workspaceDirectory,
      modelID: input.modelID,
    });
    crashBeforeMarker?.(sessionId);
    applyBindMarker(sessionId, marker);
    requireLease(input.operationId, input.leaseOwner);
    crashBeforePersist?.(sessionId);
    updateOperationWithLease(input.operationId, input.leaseOwner, {
      sessionId,
      phase: "creating_session",
      providerCreateComplete: 1,
    });
    return sessionId;
  }

  const modelID = input.modelID?.trim();
  if (!modelID) throw new JarvisCreateError("Pick a model first.", 400);
  const cliProvider = input.provider;
  const reasoning =
    cliProvider === "codex" &&
    input.reasoningEffort &&
    isCodexReasoningEffort(input.reasoningEffort)
      ? input.reasoningEffort
      : undefined;
  crashBefore?.();
  const session = await createCli(cliProvider, input.workspaceDirectory, modelID, {}, reasoning, {
    bindMarker: marker,
    crashAfterBootstrapBeforeEnsureSession: crashAfterBootstrap,
    crashAfterCreateBeforeMarker: crashBeforeMarker,
  });
  requireLease(input.operationId, input.leaseOwner);
  crashBeforePersist?.(session.id);
  updateOperationWithLease(input.operationId, input.leaseOwner, {
    sessionId: session.id,
    phase: "creating_session",
    providerCreateComplete: 1,
  });
  return session.id;
}

async function compensateBeforeSession(input: {
  operationId: string;
  leaseOwner: string;
  spaceId: string;
  workspaceDirectory: string;
  createdWorkspace: boolean;
  createdAttachment: boolean;
  repositoryId?: string;
  error: string;
}): Promise<void> {
  // Atomically claim compensation while lease-owned and clear ownership flags BEFORE
  // side effects. A crash after this point cannot delete user replacements on retry.
  requireLease(input.operationId, input.leaseOwner);
  const row = getOperationById(input.operationId);
  if (!row || row.leaseOwner !== input.leaseOwner) throw new JarvisLeaseLostError();

  const claimWorkspace = row.createdWorkspace === 1 && input.createdWorkspace;
  const claimAttachment = row.createdAttachment === 1 && input.createdAttachment;

  updateOperationWithLease(input.operationId, input.leaseOwner, {
    phase: "failed",
    error: input.error,
    createdWorkspace: 0,
    createdAttachment: 0,
  });
  jarvisCreateDeps.crashAfterCompensationClaim?.();

  if (claimAttachment && input.repositoryId) {
    requireLease(input.operationId, input.leaseOwner);
    try {
      await applySpaceAction(input.spaceId, {
        action: "releaseRepository",
        repoId: input.repositoryId,
      });
    } catch {
      // Best-effort compensation.
    }
    jarvisCreateDeps.crashAfterCompensationRelease?.();
  }

  if (claimWorkspace) {
    requireLease(input.operationId, input.leaseOwner);
    removeJarvisWorkspaceDirectory(input.workspaceDirectory);
    jarvisCreateDeps.crashAfterCompensationWorkspaceRm?.();
  }
}

function toJarvisCreateFailure(error: unknown): JarvisCreateError {
  if (error instanceof JarvisCreateError) return error;
  const fiberCause = readFiberFailureCause(error);
  if (fiberCause) {
    for (const failure of Cause.failures(fiberCause)) {
      if (failure instanceof JarvisCreateError) return failure;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return new JarvisCreateError(message, statusFromUnknownError(error));
}

const FiberFailureCauseSym = Symbol.for("effect/Runtime/FiberFailure/Cause");

function readFiberFailureCause(error: unknown): Cause.Cause<unknown> | undefined {
  if (!error || typeof error !== "object") return undefined;
  const cause = (error as Record<symbol, unknown>)[FiberFailureCauseSym];
  return Cause.isCause(cause) ? (cause as Cause.Cause<unknown>) : undefined;
}

function acquireOperationLock(key: string): Promise<{ release: () => void }> {
  const previous = operationLocks.get(key) ?? Promise.resolve();
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const current = previous.then(() => gate);
  operationLocks.set(
    key,
    current.catch(() => undefined),
  );
  return previous
    .catch(() => undefined)
    .then(() => ({
      release: () => {
        releaseGate();
        if (operationLocks.get(key) === current) operationLocks.delete(key);
      },
    }));
}

function withOperationLockEffect<A, E>(
  key: string,
  run: Effect.Effect<A, E>,
): Effect.Effect<A, E | JarvisCreateError> {
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => acquireOperationLock(key),
      catch: (error) =>
        new JarvisCreateError(error instanceof Error ? error.message : String(error), 500),
    }),
    () => run,
    (handle) => Effect.sync(() => handle.release()),
  );
}

/**
 * Create or resume a Jarvis session in a space.
 * Public payload must not include resumeSessionId — the operation row is the source of truth.
 */
export function createJarvisInSpaceEffect(
  input: CreateJarvisInSpaceInput,
): Effect.Effect<CreateJarvisInSpaceResult, JarvisCreateError> {
  return Effect.gen(function* () {
    const prepared = yield* Effect.try({
      try: () => {
        requireSpace(input.spaceId);
        const alias = input.name.trim().replace(/\s+/g, " ");
        if (!alias || alias.length > 80) {
          throw new JarvisCreateError("Name is required and must be 80 characters or fewer.", 400);
        }
        if (!input.modelID?.trim()) {
          throw new JarvisCreateError("Pick a model first.", 400);
        }
        if (input.provider === "opencode" && !parseOpenCodeModelSelection(input.modelID)) {
          throw new JarvisCreateError("Pick an OpenCode model (provider/model).", 400);
        }
        if (input.reasoningEffort && !isCodexReasoningEffort(input.reasoningEffort)) {
          throw new JarvisCreateError("Invalid reasoning effort.", 400);
        }
        const settings = getAppSettings();
        const { slug, workspaceDirectory: resolvedWorkspace } = resolveJarvisWorkspacePath(
          alias,
          settings.preferredJarvisParentPath,
        );
        const fingerprint = providerConfigFingerprint({
          provider: input.provider,
          modelID: input.modelID,
          reasoningEffort: input.reasoningEffort,
        });
        return {
          alias,
          slug,
          resolvedWorkspace,
          fingerprint,
          lockKey: `${input.spaceId}\0${alias}`,
        };
      },
      catch: toJarvisCreateFailure,
    });

    return yield* withOperationLockEffect(
      prepared.lockKey,
      Effect.gen(function* () {
        const { operation, resumed } = yield* Effect.try({
          try: () => ensureJarvisCreateOperationRow(input, prepared),
          catch: toJarvisCreateFailure,
        });
        const leaseOwner = `pid-${process.pid}-${randomUUID()}`;
        return yield* withJarvisCreateLeaseEffect(
          operation.id,
          leaseOwner,
          Effect.tryPromise({
            try: () =>
              runLeasedJarvisCreateBody({
                input,
                alias: prepared.alias,
                operationId: operation.id,
                leaseOwner,
                resumed,
              }),
            catch: toJarvisCreateFailure,
          }),
        );
      }),
    );
  });
}

export async function createJarvisInSpace(
  input: CreateJarvisInSpaceInput,
): Promise<CreateJarvisInSpaceResult> {
  return Effect.runPromise(createJarvisInSpaceEffect(input));
}

function ensureJarvisCreateOperationRow(
  input: CreateJarvisInSpaceInput,
  prepared: {
    alias: string;
    slug: string;
    resolvedWorkspace: string;
    fingerprint: string;
  },
): { operation: DbJarvisCreateOperation; resumed: boolean } {
  const { alias, slug, resolvedWorkspace, fingerprint } = prepared;
  let operation = getOperationBySpaceAlias(input.spaceId, alias);
  const resumed = Boolean(operation?.sessionId);

  if (operation?.phase === "invalidated") {
    throw new JarvisCreateError(
      "This Jarvis create was invalidated after its session was deleted. Use a different name.",
      409,
    );
  }

  if (!operation) {
    const byPath = getOperationByWorkspace(resolvedWorkspace);
    if (byPath && byPath.spaceId !== input.spaceId) {
      throw new JarvisCreateError(
        "This Jarvis workspace path is already claimed by another space.",
        409,
      );
    }
    if (byPath && byPath.alias !== alias) {
      throw new JarvisCreateError(
        "This Jarvis workspace path is already claimed by another create operation.",
        409,
      );
    }
    operation = byPath ?? undefined;
  }

  if (operation && operation.providerConfigFingerprint !== fingerprint) {
    throw new JarvisCreateError(
      "A Jarvis create operation already exists for this workspace with different provider settings.",
      409,
    );
  }

  if (!operation) {
    const id = `jarvis-create-${randomUUID()}`;
    try {
      drizzleDb
        .insert(jarvisCreateOperations)
        .values({
          id,
          spaceId: input.spaceId,
          workspaceIdentity: resolvedWorkspace,
          workspaceDirectory: resolvedWorkspace,
          alias,
          slug,
          provider: input.provider,
          providerConfigFingerprint: fingerprint,
          modelId: input.modelID?.trim() || null,
          reasoningEffort: input.reasoningEffort?.trim() || null,
          phase: "pending",
          createdWorkspace: 0,
          createdAttachment: 0,
          providerCreateComplete: 0,
        })
        .run();
    } catch {
      // Concurrent insert won a unique constraint.
    }
    operation = getOperationBySpaceAlias(input.spaceId, alias);
    if (!operation) {
      const byPath = getOperationByWorkspace(resolvedWorkspace);
      if (byPath?.spaceId !== input.spaceId) {
        throw new JarvisCreateError(
          "This Jarvis workspace path is already claimed by another space.",
          409,
        );
      }
      operation = byPath ?? undefined;
    }
    if (!operation) throw new JarvisCreateError("Unable to create Jarvis operation.", 500);
    if (operation.providerConfigFingerprint !== fingerprint) {
      throw new JarvisCreateError(
        "A Jarvis create operation already exists for this workspace with different provider settings.",
        409,
      );
    }
  }

  return { operation, resumed };
}

function readBootstrapStatus(value: string | null | undefined): JarvisBootstrapStatus {
  if (value === "delivered" || value === "queued" || value === "failed") return value;
  return "queued";
}

async function runLeasedJarvisCreateBody(args: {
  input: CreateJarvisInSpaceInput;
  alias: string;
  operationId: string;
  leaseOwner: string;
  resumed: boolean;
}): Promise<CreateJarvisInSpaceResult> {
  const { input, alias, leaseOwner } = args;
  let resumed = args.resumed;
  let operation = getOperationById(args.operationId);
  if (!operation) throw new JarvisCreateError("Jarvis create operation not found.", 500);

  if (operation.phase === "completed") {
    const existing = operation.sessionId ? getSession(operation.sessionId) : null;
    if (!existing) {
      updateOperationWithLease(operation.id, leaseOwner, {
        phase: "invalidated",
        error: "Jarvis session was deleted after create completed.",
        sessionId: null,
      });
      throw new JarvisCreateError(
        "This Jarvis create was invalidated after its session was deleted. Use a different name.",
        409,
      );
    }
    const session =
      operation.provider === "opencode"
        ? await addOpenCodeStatus(ensureSession(existing.id))
        : ensureSession(existing.id);
    const state = await spaceStateNow();
    state.selectedSpaceId = input.spaceId;
    return {
      state,
      session,
      workspaceDirectory: operation.workspaceDirectory,
      bootstrapStatus: readBootstrapStatus(operation.bootstrapStatus),
      bootstrapError: operation.bootstrapError || undefined,
      resumed: true,
    };
  }

  if (operation.phase === "invalidated") {
    throw new JarvisCreateError(
      "This Jarvis create was invalidated after its session was deleted. Use a different name.",
      409,
    );
  }

  const workspaceDirectory = operation.workspaceDirectory;
  let repositoryId: string | undefined;
  let createdWorkspace = Boolean(operation.createdWorkspace);
  let createdAttachment = Boolean(operation.createdAttachment);

  try {
    requireLease(operation.id, leaseOwner);
    updateOperationWithLease(operation.id, leaseOwner, { phase: "staging" });

    // Persist ownership BEFORE mkdir/materialize so a crash mid-stage remains recoverable.
    // Only claim when the directory is missing — never infer ownership from file contents
    // (a user's AGENTS.md must not become compensatable). Resume partials only via this flag.
    const pathMissing = !existsSync(workspaceDirectory);
    if (!createdWorkspace && pathMissing) {
      createdWorkspace = true;
      updateOperationWithLease(operation.id, leaseOwner, { createdWorkspace: 1 });
      jarvisCreateDeps.crashAfterStagingOwnership?.();
    }

    const staged = stageJarvisWorkspaceAt(workspaceDirectory, operation.slug, {
      resumeOwnedPartial: createdWorkspace,
      crashAfterMkdirBeforeMaterialize: jarvisCreateDeps.crashAfterStagingMkdirBeforeMaterialize,
      crashDuringMaterialize: jarvisCreateDeps.crashDuringStagingMaterialize,
      crashAfterMaterialize: jarvisCreateDeps.crashAfterStagingMaterialize,
    });
    resumed = resumed || staged.resumed;
    if (staged.createdDirectory && !createdWorkspace) {
      createdWorkspace = true;
      updateOperationWithLease(operation.id, leaseOwner, { createdWorkspace: 1 });
    }

    requireLease(operation.id, leaseOwner);
    updateOperationWithLease(operation.id, leaseOwner, { phase: "git_init" });
    const initializedNewGitRepo = !staged.resumed;
    if (staged.resumed) {
      await validateJarvisGitRepo(workspaceDirectory);
    } else {
      await initializeJarvisGitRepo(workspaceDirectory);
    }

    requireLease(operation.id, leaseOwner);
    updateOperationWithLease(operation.id, leaseOwner, { phase: "attaching" });

    // Attach first; only claim compensation ownership when this call created the link.
    // Never preclaim — a crash after preclaim on a pre-existing link would release it later.
    const attached = await applySpaceAction(input.spaceId, {
      action: "attachRepository",
      path: workspaceDirectory,
      name: operation.slug,
    });
    repositoryId =
      "repositoryId" in attached && typeof attached.repositoryId === "string"
        ? attached.repositoryId
        : undefined;
    jarvisCreateDeps.crashAfterAttachBeforeCreatedAttachment?.();
    const newlyAttached = "createdLink" in attached && attached.createdLink === true;
    if (newlyAttached) {
      createdAttachment = true;
      updateOperationWithLease(operation.id, leaseOwner, { createdAttachment: 1 });
    } else if (!createdAttachment) {
      // Pre-existing or ambiguous link — do not compensate-release it.
      createdAttachment = false;
    }

    requireLease(operation.id, leaseOwner);
    let sessionId = await reconcileProviderSessionIfNeeded({
      operationId: operation.id,
      leaseOwner,
      workspaceDirectory,
      sessionId: operation.sessionId,
      provider: operation.provider,
      providerCreateComplete: operation.providerCreateComplete,
    });
    operation = getOperationById(operation.id)!;
    sessionId = operation.sessionId;

    if (sessionId && !operation.providerCreateComplete && canPreallocateSessionId(input.provider)) {
      await repairIncompletePreallocatedSession({
        operationId: operation.id,
        leaseOwner,
        provider: input.provider,
        sessionId,
        workspaceDirectory,
        modelID: input.modelID,
      });
      operation = getOperationById(operation.id)!;
      resumed = true;
    } else if (!sessionId) {
      sessionId = await createAndBindProviderSession({
        operationId: operation.id,
        leaseOwner,
        provider: input.provider,
        workspaceDirectory,
        alias,
        modelID: input.modelID,
        reasoningEffort: input.reasoningEffort,
      });
      operation = getOperationById(operation.id)!;
    } else {
      resumed = true;
    }

    requireLease(operation.id, leaseOwner);
    updateOperationWithLease(operation.id, leaseOwner, { phase: "claiming" });
    await applySpaceAction(input.spaceId, { action: "claimSession", sessionId: sessionId! });
    updateSessionState(sessionId!, "jarvis");
    setSessionAliasIfSafe(sessionId!, alias);
    if (input.provider === "opencode") {
      await updateOpenCodeTitle(sessionId!, alias);
    }
    recordJarvisSessionArtifact({
      name: alias,
      sessionId: sessionId!,
      workspaceDirectory,
    });
    // Keep brand-new Jarvis repos clean: commit sessions.md only when we own the
    // initial git history — never commit into a resumed user repo.
    if (initializedNewGitRepo) {
      await commitJarvisWorkspaceChanges(workspaceDirectory, "Record Jarvis session");
    }

    requireLease(operation.id, leaseOwner);
    updateOperationWithLease(operation.id, leaseOwner, { phase: "bootstrapping" });
    let bootstrapStatus: JarvisBootstrapStatus = "queued";
    let bootstrapError: string | undefined;
    try {
      const bootstrapClientMessageId =
        operation.bootstrapClientMessageId ?? `jarvis-bootstrap:${operation.id}`;
      if (!operation.bootstrapClientMessageId) {
        updateOperationWithLease(operation.id, leaseOwner, { bootstrapClientMessageId });
      }
      const existingMessage = getMessageByClientId(sessionId!, "user", bootstrapClientMessageId);
      const message =
        existingMessage ??
        insertMessageRow({
          sessionId: sessionId!,
          text: readJarvisBootstrapMessage(),
          extraMarkdown: null,
          author: "user",
          status: "received",
          links: null,
          sessionRefs: null,
          clientMessageId: bootstrapClientMessageId,
        });
      // Always enqueue — delivery jobs are unique on (messageId, kind).
      enqueueJarvisBootstrap(sessionId!, message.id);
      broadcastQueue(sessionId!);
      const delivered = getMessage(message.id) ?? message;
      if (delivered.opencodeDeliveryStatus === "failed") {
        bootstrapStatus = "failed";
        bootstrapError = delivered.opencodeDeliveryError || "Bootstrap delivery failed.";
      } else if (delivered.opencodeDeliveryStatus === "sent") {
        // Workers persist "sent" (not "delivered") on successful delivery.
        bootstrapStatus = "delivered";
      } else {
        bootstrapStatus = "queued";
      }
    } catch (error) {
      bootstrapStatus = "failed";
      bootstrapError = error instanceof Error ? error.message : String(error);
    }

    requireLease(operation.id, leaseOwner);
    updateOperationWithLease(operation.id, leaseOwner, {
      phase: "completed",
      bootstrapStatus,
      bootstrapError: bootstrapError ?? null,
      error: null,
      sessionId: sessionId!,
    });

    broadcastSessions();
    const session =
      input.provider === "opencode"
        ? await addOpenCodeStatus(ensureSession(sessionId!))
        : ensureSession(sessionId!);
    const state = await spaceStateNow();
    state.selectedSpaceId = input.spaceId;
    return {
      state,
      session,
      workspaceDirectory,
      bootstrapStatus,
      bootstrapError,
      resumed,
    };
  } catch (error) {
    if (error instanceof JarvisLeaseLostError) {
      // Stale owner must not compensate or mutate successor state.
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = statusFromUnknownError(error);
    if (!ownsJarvisCreateLease(operation.id, leaseOwner)) {
      throw new JarvisLeaseLostError();
    }
    const current = getOperationById(operation.id);
    if (!current?.sessionId) {
      await compensateBeforeSession({
        operationId: operation.id,
        leaseOwner,
        spaceId: input.spaceId,
        workspaceDirectory,
        createdWorkspace,
        createdAttachment,
        repositoryId,
        error: message,
      });
    } else if (current.phase !== "invalidated") {
      updateOperationWithLease(operation.id, leaseOwner, {
        phase: "failed",
        error: message,
      });
    }
    throw new JarvisCreateError(message, status);
  }
}
