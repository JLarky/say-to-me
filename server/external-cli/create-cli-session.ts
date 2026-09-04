import { randomUUID } from "node:crypto";
import { bootstrapCodexThread } from "../codex/bootstrap.ts";
import type { DbSession } from "../db/schemas.ts";
import { bootstrapGrokSession } from "../grok/bootstrap.ts";
import { CLAUDE_SESSION, CODEX_SESSION, CURSOR_SESSION, GROK_SESSION } from "../session-id.ts";
import {
  ensureSession,
  setSessionAliasIfSafe,
  setSessionCwd,
  updateSessionModelAndReasoningEffort,
  updateSessionOpenCodeModel,
} from "../sessions.ts";
import { EXTERNAL_CLI_BOOTSTRAP_PROMPT } from "./bootstrap-prompt.ts";
import { canonicalCwd } from "./canonical-cwd.ts";
import { prefixedUuidSessionId } from "./prefixed-session.ts";
import type { ExternalCliBackend } from "./session-backend.ts";
import type { CodexReasoningEffort } from "../../src/codex-reasoning-effort.ts";

const PROVIDER_MODEL_IDS = {
  claude: "anthropic",
  codex: "openai",
  cursor: "cursor",
  grok: "xai",
} satisfies Record<ExternalCliBackend, string>;

const PROVIDER_SESSION = {
  claude: CLAUDE_SESSION,
  codex: CODEX_SESSION,
  cursor: CURSOR_SESSION,
  grok: GROK_SESSION,
} as const;

export type CreateCliSessionDeps = {
  /** Override Codex create-time bootstrap (tests). Default runs real `codex exec`. */
  bootstrapCodexThread?: typeof bootstrapCodexThread;
  /** Override Grok create-time bootstrap (tests). Default runs real `grok --single`. */
  bootstrapGrokSession?: typeof bootstrapGrokSession;
};

export type CreateCliSessionOptions = {
  /** Pre-bound raw UUID for claude/cursor so callers can persist the session id first. */
  preallocatedRawUuid?: string;
  /** Apply immediately after local session row exists (before return). */
  bindMarker?: string;
  /**
   * Test hook: after Codex/Grok remote bootstrap returns an id, before any local
   * ensureSession/marker. Documents the remote-orphan window — we embed bindMarker
   * in the bootstrap prompt for manual recovery but do not claim exact-once reconcile.
   */
  crashAfterBootstrapBeforeEnsureSession?: (sessionId: string) => void;
  /** Test hook: after remote/local id exists and ensureSession ran, before bindMarker. */
  crashAfterCreateBeforeMarker?: (sessionId: string) => void;
};

/**
 * Create a new external-CLI session row.
 * Codex/Grok allocate a real provider session at create so delivery can always resume.
 * Other providers keep a local random UUID prefix id until they need the same treatment.
 *
 * Codex/Grok: a crash after remote bootstrap returns but before ensureSession leaves a
 * remote session with no local row. bindMarker is included in the bootstrap prompt so
 * operators can identify orphans manually; automatic exact-once recovery is not claimed.
 */
export async function createCliSessionRecord(
  provider: ExternalCliBackend,
  workspacePath: string,
  modelID: string,
  deps: CreateCliSessionDeps = {},
  reasoningEffort?: CodexReasoningEffort,
  options: CreateCliSessionOptions = {},
): Promise<DbSession> {
  const cwd = canonicalCwd(workspacePath);
  const model = modelID.trim();
  const bootstrapPrompt = options.bindMarker
    ? `${EXTERNAL_CLI_BOOTSTRAP_PROMPT}\n${options.bindMarker}`
    : EXTERNAL_CLI_BOOTSTRAP_PROMPT;
  let rawUuid: string = options.preallocatedRawUuid ?? randomUUID();
  if (provider === "codex") {
    const bootstrap = deps.bootstrapCodexThread ?? bootstrapCodexThread;
    rawUuid = await bootstrap({ cwd, model, reasoningEffort, prompt: bootstrapPrompt });
  } else if (provider === "grok") {
    const bootstrap = deps.bootstrapGrokSession ?? bootstrapGrokSession;
    rawUuid = await bootstrap({ cwd, model, prompt: bootstrapPrompt });
  }
  const sessionId = prefixedUuidSessionId(PROVIDER_SESSION[provider], rawUuid);
  if (!sessionId) throw new Error("Unable to allocate CLI session id.");
  // Remote id exists; local row does not yet — orphan window for Codex/Grok.
  options.crashAfterBootstrapBeforeEnsureSession?.(sessionId);
  ensureSession(sessionId);
  options.crashAfterCreateBeforeMarker?.(sessionId);
  if (options.bindMarker) {
    setSessionAliasIfSafe(sessionId, options.bindMarker);
  }
  if (provider === "codex" && reasoningEffort) {
    updateSessionModelAndReasoningEffort(
      sessionId,
      PROVIDER_MODEL_IDS[provider],
      model,
      reasoningEffort,
    );
  } else {
    updateSessionOpenCodeModel(sessionId, PROVIDER_MODEL_IDS[provider], model);
  }
  return setSessionCwd(sessionId, cwd);
}
