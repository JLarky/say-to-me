import {
  type Model as OcConfigModel,
  type ModelV2Info as OcModel,
  type Project as OcProject,
  type Provider as OcProvider,
  type Session as OcSession,
  type VcsInfo as OcVcsInfo,
} from "@opencode-ai/sdk/v2/client";
import { Duration, Effect } from "effect";
import { OpenCodeStatus } from "../../src/types.ts";
import {
  opencodeDirectory,
  opencodeStatusCacheMs,
  opencodeStatusTimeoutMs,
  opencodeTitleCacheMs,
} from "../config.ts";
import { DbSession } from "../db/schemas.ts";
import {
  detectSessionBackend,
  isOpenCodeSessionId,
  sessionHref,
  validateSessionId,
} from "../session-id.ts";
import { importNotFoundError, type ImportNotFoundError } from "../session-import-error.ts";
import { layerForBackend } from "../session-services/session-router.ts";
import { SessionTitle } from "../session-services/interfaces.ts";
import { ensureSession, listSessions, setOpenCodeContext } from "../sessions.ts";
import {
  type OpenCodeSessionInfoCacheEntry,
  opencodeSessionInfoCache,
  opencodeStatusCache,
} from "./cache.ts";
import { mapOpenCodeSessionCreateFailure } from "./session-create-result.ts";
import { createOpenCodeClient, openCodeBaseUrl, openCodeFetch } from "./http.ts";
import { readOpenCodeModelReasoningEfforts } from "./reasoning-effort.ts";

function mapOpenCodeStatus(
  status: { type?: string; message?: unknown } | null | undefined,
): typeof OpenCodeStatus.infer {
  if (status?.type === "busy") return "pending";
  if (status?.type === "idle") return "idle";
  // OpenCode SessionStatus is idle | busy | retry (no type:"error" in the SDK).
  if (status?.type === "retry") return "retrying";
  if (status?.type === "error") return "error";
  return "unavailable";
}

/** Raw retry message from OpenCode status (e.g. "Free usage exceeded, subscribe to Go"). */
export function mapOpenCodeStatusReason(
  status: { type?: string; message?: unknown } | null | undefined,
): string | null {
  if (status?.type !== "retry") return null;
  const message = typeof status.message === "string" ? status.message.trim() : "";
  return message || null;
}

export async function getOpenCodeStatus(
  sessionId: string,
  { baseUrl = openCodeBaseUrl(), forceRefresh = false } = {},
): Promise<typeof OpenCodeStatus.infer | null> {
  if (!validateSessionId(sessionId)) return null;

  const sessionInfo = await getOpenCodeSessionInfo(sessionId, { baseUrl });
  const directory = sessionInfo?.directory || opencodeDirectory;
  const cacheKey = `${baseUrl}\n${directory}\n${sessionId}`;
  const cached = opencodeStatusCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.time < opencodeStatusCacheMs) {
    return cached.status;
  }

  try {
    const client = createOpenCodeClient(baseUrl, async (request) => {
      return Effect.runPromise(
        Effect.tryPromise((signal) => openCodeFetch(request, { signal })).pipe(
          Effect.timeoutFail({
            duration: Duration.millis(opencodeStatusTimeoutMs),
            onTimeout: () => new Error("OpenCode status request timed out."),
          }),
        ),
      );
    });
    const result = await client.session.status({ directory });
    if (result.response.status < 200 || result.response.status >= 300) {
      opencodeStatusCache.set(cacheKey, { status: "unavailable", reason: null, time: Date.now() });
      return "unavailable";
    }
    const explicitStatus = result.data?.[sessionId];
    if (explicitStatus) {
      const status = mapOpenCodeStatus(explicitStatus);
      const reason = mapOpenCodeStatusReason(explicitStatus);
      opencodeStatusCache.set(cacheKey, { status, reason, time: Date.now() });
      return status;
    }
    if (sessionInfo) {
      opencodeStatusCache.set(cacheKey, { status: "idle", reason: null, time: Date.now() });
      return "idle";
    }

    const list = await client.session.list({ directory });
    const status =
      list.response.status >= 200 &&
      list.response.status < 300 &&
      list.data?.some((session) => session.id === sessionId)
        ? "idle"
        : "unavailable";
    opencodeStatusCache.set(cacheKey, { status, reason: null, time: Date.now() });
    return status;
  } catch {
    opencodeStatusCache.set(cacheKey, { status: "unavailable", reason: null, time: Date.now() });
    return "unavailable";
  }
}

export async function getOpenCodeSessionInfo(
  sessionId: string,
  { baseUrl = openCodeBaseUrl() } = {},
): Promise<OpenCodeSessionInfoCacheEntry | null> {
  if (!validateSessionId(sessionId)) return null;
  const cached = opencodeSessionInfoCache.get(sessionId);
  if (cached && Date.now() - cached.time < opencodeTitleCacheMs) return cached;
  try {
    const client = createOpenCodeClient(baseUrl, async (request) => {
      return Effect.runPromise(
        Effect.tryPromise((signal) => openCodeFetch(request, { signal })).pipe(
          Effect.timeoutFail({
            duration: Duration.millis(opencodeStatusTimeoutMs),
            onTimeout: () => new Error("OpenCode session info request timed out."),
          }),
        ),
      );
    });
    const result = await client.session.get({ sessionID: sessionId });
    if (result.response.status < 200 || result.response.status >= 300) return null;
    const info = {
      title: result.data?.title || null,
      directory: result.data?.directory || null,
      agent: result.data?.agent || null,
      modelProvider: result.data?.model?.providerID || null,
      model: result.data?.model?.id || null,
      time: Date.now(),
    } satisfies OpenCodeSessionInfoCacheEntry;
    opencodeSessionInfoCache.set(sessionId, info);
    return info;
  } catch {
    return null;
  }
}

export async function getOpenCodeTitle(sessionId: string): Promise<string | null> {
  return (await getOpenCodeSessionInfo(sessionId))?.title ?? null;
}

export async function updateOpenCodeTitle(
  sessionId: string,
  title: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!validateSessionId(sessionId)) {
    return { ok: false, status: 400, error: "Invalid OpenCode session id." };
  }

  try {
    const previous = await getOpenCodeSessionInfo(sessionId);
    const directory = previous?.directory || opencodeDirectory;
    const client = createOpenCodeClient();
    const result = await client.session.update({ sessionID: sessionId, directory, title });
    if (result.response.status < 200 || result.response.status >= 300) {
      return {
        ok: false,
        status: result.response.status,
        error: `OpenCode returned HTTP ${result.response.status}`,
      };
    }
    opencodeSessionInfoCache.set(sessionId, {
      title: result.data?.title || title,
      directory: result.data?.directory || directory,
      agent: result.data?.agent ?? previous?.agent ?? null,
      modelProvider: result.data?.model?.providerID ?? previous?.modelProvider ?? null,
      model: result.data?.model?.id ?? previous?.model ?? null,
      time: Date.now(),
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: (error as Error).message || "Unable to update OpenCode session title.",
    };
  }
}

export async function compactOpenCodeSession(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!validateSessionId(sessionId)) {
    return { ok: false, status: 400, error: "Invalid OpenCode session id." };
  }

  try {
    const session = await getOpenCodeSessionInfo(sessionId);
    const directory = session?.directory || opencodeDirectory;
    const providerID = session?.modelProvider;
    const modelID = session?.model;
    if (!providerID || !modelID) {
      return { ok: false, status: 502, error: "OpenCode session model is unavailable." };
    }

    const baseUrl = openCodeBaseUrl();
    const url = new URL(
      `/session/${sessionId}/summarize`,
      baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
    );
    url.searchParams.set("directory", directory);
    const response = await openCodeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerID, modelID, auto: false }),
      signal: AbortSignal.timeout(opencodeCompactTimeoutMs),
    });
    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        status: response.status || 502,
        error: `OpenCode returned HTTP ${response.status}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: (error as Error).message || "Unable to compact OpenCode session.",
    };
  }
}

const opencodeCompactTimeoutMs = Number(
  process.env.SAY_TO_ME_OPENCODE_COMPACT_TIMEOUT_MS || 180_000,
);

export type OpenCodeModel = Pick<OcModel, "providerID" | "id" | "name"> & {
  reasoningEfforts: string[];
};

function unwrapOpenCodeModels(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const envelope = data as Record<string, unknown>;
    if (Array.isArray(envelope.data)) return envelope.data;
  }
  return [];
}

function mapOpenCodeModel(model: unknown): OpenCodeModel | null {
  if (!model || typeof model !== "object") return null;
  const value = model as Record<string, unknown>;
  if (typeof value.providerID !== "string" || typeof value.id !== "string") return null;
  return {
    providerID: value.providerID,
    id: value.id,
    name: typeof value.name === "string" ? value.name : value.id,
    reasoningEfforts: readOpenCodeModelReasoningEfforts(
      value.options && typeof value.options === "object"
        ? (value.options as Record<string, unknown>)
        : {},
      value.variants && typeof value.variants === "object"
        ? (value.variants as Record<string, unknown>)
        : undefined,
    ),
  };
}

function mapConfigProviderModel(provider: OcProvider, model: OcConfigModel): OpenCodeModel | null {
  if (model.status === "deprecated") return null;
  return {
    providerID: provider.id,
    id: model.id,
    name: model.name || model.id,
    reasoningEfforts: readOpenCodeModelReasoningEfforts(model.options ?? {}, model.variants),
  };
}

export async function listOpenCodeModels(directory?: string | null): Promise<OpenCodeModel[]> {
  const client = createOpenCodeClient();
  const configResult = await client.config.providers(directory ? { directory } : undefined);
  if (
    configResult.response &&
    configResult.response.status >= 200 &&
    configResult.response.status < 300
  ) {
    return (configResult.data?.providers ?? []).flatMap((provider) =>
      Object.values(provider.models).flatMap((model) => {
        const mapped = mapConfigProviderModel(provider, model);
        return mapped ? [mapped] : [];
      }),
    );
  }

  const result = await client.v2.model.list(directory ? { instance: { directory } } : undefined);
  if (!result.response || result.response.status < 200 || result.response.status >= 300) {
    throw new Error(
      result.response
        ? `OpenCode returned HTTP ${result.response.status}`
        : result.error instanceof Error
          ? result.error.message
          : "OpenCode API call failed",
    );
  }
  return unwrapOpenCodeModels(result.data).flatMap((model) => {
    const mapped = mapOpenCodeModel(model);
    return mapped ? [mapped] : [];
  });
}

export async function setOpenCodeSessionModel(
  sessionId: string,
  providerID: string,
  modelID: string,
  directory?: string | null,
  variant?: string | null,
): Promise<void> {
  const baseUrl = openCodeBaseUrl();
  const url = new URL(`/api/session/${encodeURIComponent(sessionId)}/model`, baseUrl);
  if (directory) url.searchParams.set("directory", directory);
  const response = await openCodeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: variant ? { providerID, id: modelID, variant } : { providerID, id: modelID },
    }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`OpenCode returned HTTP ${response.status}`);
  }
}

export async function getOpenCodeSessionModel(
  sessionId: string,
  directory?: string | null,
): Promise<{ providerID: string; modelID: string; variant: string | null }> {
  const client = createOpenCodeClient();
  const result = await client.session.get(
    directory ? { sessionID: sessionId, directory } : { sessionID: sessionId },
  );
  if (!result.response || result.response.status < 200 || result.response.status >= 300) {
    throw new Error(
      result.response
        ? `OpenCode returned HTTP ${result.response.status}`
        : result.error instanceof Error
          ? result.error.message
          : "OpenCode API call failed",
    );
  }
  const providerID = result.data?.model?.providerID;
  const modelID = result.data?.model?.id;
  if (!providerID || !modelID) throw new Error("OpenCode session model is unavailable.");
  return { providerID, modelID, variant: result.data?.model?.variant ?? null };
}

export async function stopOpenCodeSession(
  sessionId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!validateSessionId(sessionId)) {
    return { ok: false, status: 400, error: "Invalid OpenCode session id." };
  }

  try {
    const directory = (await getOpenCodeSessionInfo(sessionId))?.directory || opencodeDirectory;
    const client = createOpenCodeClient();
    const result = await client.session.abort({
      sessionID: sessionId,
      directory,
    });
    if (result.response.status < 200 || result.response.status >= 300) {
      return {
        ok: false,
        status: result.response.status,
        error: `OpenCode returned HTTP ${result.response.status}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: (error as Error).message || "Unable to stop OpenCode session.",
    };
  }
}

type OpenCodeContext = {
  projectId: OcSession["projectID"] | null;
  workspaceId: NonNullable<OcSession["workspaceID"]> | null;
  directory: OcSession["directory"];
  path: NonNullable<OcSession["path"]> | null;
  worktree: OcProject["worktree"] | null;
  projectName: NonNullable<OcProject["name"]> | null;
  branch: NonNullable<OcVcsInfo["branch"]> | null;
};

async function captureOpenCodeContext(
  client: ReturnType<typeof createOpenCodeClient>,
  session: DbSession,
  ocSession: OcSession,
): Promise<DbSession> {
  const directory = ocSession.directory || opencodeDirectory;
  let projectId: OpenCodeContext["projectId"] = ocSession.projectID || null;
  let worktree: OpenCodeContext["worktree"] = null;
  let projectName: OpenCodeContext["projectName"] = null;
  let branch: OpenCodeContext["branch"] = null;

  try {
    const project = await client.project.current({ directory });
    if (project.response.status >= 200 && project.response.status < 300 && project.data) {
      projectId = project.data.id || projectId;
      worktree = project.data.worktree || null;
      projectName = project.data.name || null;
    }
  } catch {
    // Keep session creation working even when project metadata is unavailable.
  }

  try {
    const vcs = await client.vcs.get({ directory });
    if (vcs.response.status >= 200 && vcs.response.status < 300 && vcs.data) {
      branch = vcs.data.branch || null;
    }
  } catch {
    // The git branch is a nice-to-have label segment; ignore when unavailable.
  }

  const ctx = {
    projectId,
    workspaceId: ocSession.workspaceID ?? null,
    directory,
    path: ocSession.path ?? null,
    worktree,
    projectName,
    branch,
  } satisfies OpenCodeContext;

  setOpenCodeContext(session.id, ctx);

  return {
    ...session,
    cwd: ctx.directory,
    opencodeProjectId: ctx.projectId,
    opencodeWorkspaceId: ctx.workspaceId,
    opencodeDirectory: ctx.directory,
    opencodeWorktree: ctx.worktree,
    opencodePath: ctx.path,
    opencodeProjectName: ctx.projectName,
    opencodeBranch: ctx.branch,
  };
}

export async function createOpenCodeSession(
  directory: string,
  options: { title?: string } = {},
): Promise<{ ok: true; session: DbSession } | { ok: false; status: number; error: string }> {
  try {
    const client = createOpenCodeClient();
    const result = await client.session.create(
      options.title ? { directory, title: options.title } : { directory },
    );
    // v2 SDK network failures can omit `response` entirely.
    if (!result.response || result.response.status < 200 || result.response.status >= 300) {
      return mapOpenCodeSessionCreateFailure(result);
    }
    if (!result.data?.id) {
      return {
        ok: false,
        status: result.response.status || 502,
        error: `OpenCode returned HTTP ${result.response.status}`,
      };
    }

    const session = ensureSession(result.data.id);
    opencodeSessionInfoCache.set(session.id, {
      title: result.data.title || options.title || null,
      directory: result.data.directory || directory,
      agent: result.data.agent || null,
      modelProvider: result.data.model?.providerID || null,
      model: result.data.model?.id || null,
      time: Date.now(),
    });
    const enriched = await captureOpenCodeContext(client, session, result.data);
    return { ok: true, session: enriched };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: (error as Error).message || "Unable to create OpenCode session.",
    };
  }
}

/** List OpenCode sessions for a directory (used to reconcile after a crash mid-create). */
export async function listOpenCodeSessionsForDirectory(
  directory: string,
): Promise<Array<{ id: string; directory?: string | null; title?: string | null }>> {
  try {
    const client = createOpenCodeClient();
    const list = await client.session.list({ directory });
    if (list.response.status < 200 || list.response.status >= 300 || !list.data) return [];
    return list.data
      .filter((session) => Boolean(session.id))
      .map((session) => ({
        id: session.id,
        directory: session.directory ?? directory,
        title: session.title ?? null,
      }));
  } catch {
    return [];
  }
}

export async function createOpenCodeWorktree(
  directory: string,
  name?: string,
): Promise<
  | { ok: true; directory: string; name: string | null }
  | { ok: false; status: number; error: string }
> {
  try {
    const client = createOpenCodeClient();
    const result = await client.worktree.create({
      directory,
      worktreeCreateInput: name ? { name } : {},
    });
    if (result.response.status < 200 || result.response.status >= 300 || !result.data) {
      return {
        ok: false,
        status: result.response.status || 502,
        error: `OpenCode returned HTTP ${result.response.status}`,
      };
    }
    if (!result.data.directory) {
      return {
        ok: false,
        status: 502,
        error: `Worktree "${result.data.name}" was created but OpenCode returned no directory.`,
      };
    }
    return { ok: true, directory: result.data.directory, name: result.data.name || null };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: (error as Error).message || "Unable to create OpenCode worktree.",
    };
  }
}

export async function createOpenCodeWorktreeSession(
  directory: string,
): Promise<{ ok: true; session: DbSession } | { ok: false; status: number; error: string }> {
  try {
    const client = createOpenCodeClient();

    const listed = await client.worktree.list({ directory });
    if (listed.data) {
      const occupied = new Set(
        listSessions()
          .map((session) => session.opencodeDirectory)
          .filter((dir): dir is string => Boolean(dir)),
      );
      const reusable = listed.data.find((dir) => !occupied.has(dir));
      if (reusable) {
        return await createOpenCodeSession(reusable);
      }
    }

    const created = await createOpenCodeWorktree(directory);
    if (!created.ok) return created;
    return await createOpenCodeSession(created.directory);
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: (error as Error).message || "Unable to create OpenCode worktree session.",
    };
  }
}

function hasOpenCodeContext(session: DbSession): boolean {
  return Boolean(
    session.opencodeProjectId ||
    session.opencodeWorkspaceId ||
    session.opencodeDirectory ||
    session.opencodeWorktree ||
    session.opencodePath ||
    session.opencodeProjectName ||
    session.opencodeBranch,
  );
}

const contextBackfillCooldownMs = 60_000;
const contextBackfillCooldown = new Map<string, number>();

export async function ensureOpenCodeContext(session: DbSession): Promise<DbSession> {
  if (!validateSessionId(session.id)) return session;
  if (hasOpenCodeContext(session)) return session;

  const cooldownUntil = contextBackfillCooldown.get(session.id);
  if (cooldownUntil && cooldownUntil > Date.now()) return session;

  try {
    const client = createOpenCodeClient();
    const result = await client.session.get({ sessionID: session.id });
    if (result.response.status < 200 || result.response.status >= 300 || !result.data?.id) {
      contextBackfillCooldown.set(session.id, Date.now() + contextBackfillCooldownMs);
      return session;
    }
    return await captureOpenCodeContext(client, session, result.data);
  } catch {
    contextBackfillCooldown.set(session.id, Date.now() + contextBackfillCooldownMs);
    return session;
  }
}

// Confirms a session id genuinely exists in OpenCode before creating a row for
// it here, so a plain 404 (typo, stale link) still doesn't auto-create a session.
// ensureSession only runs once the OpenCode lookup below has already succeeded.
export function importOpenCodeSessionIfKnown(
  sessionId: string,
): Effect.Effect<DbSession, ImportNotFoundError> {
  if (!isOpenCodeSessionId(sessionId)) return Effect.fail(importNotFoundError(sessionId));
  return Effect.gen(function* () {
    const client = createOpenCodeClient();
    const result = yield* Effect.tryPromise({
      try: () => client.session.get({ sessionID: sessionId }),
      catch: () => importNotFoundError(sessionId),
    });
    if (
      !result.response ||
      result.response.status < 200 ||
      result.response.status >= 300 ||
      !result.data?.id
    ) {
      return yield* Effect.fail(importNotFoundError(sessionId));
    }
    return yield* Effect.tryPromise({
      try: () => captureOpenCodeContext(client, ensureSession(sessionId), result.data),
      catch: () => importNotFoundError(sessionId),
    });
  });
}

export async function reimportOpenCodeContext(
  session: DbSession,
): Promise<{ ok: true; session: DbSession } | { ok: false; status: number; error: string }> {
  if (!validateSessionId(session.id)) {
    return { ok: false, status: 400, error: "Invalid OpenCode session id." };
  }

  try {
    const client = createOpenCodeClient();
    const result = await client.session.get({ sessionID: session.id });
    if (result.response.status < 200 || result.response.status >= 300 || !result.data?.id) {
      return {
        ok: false,
        status: result.response.status || 502,
        error: `OpenCode returned HTTP ${result.response.status}`,
      };
    }
    contextBackfillCooldown.delete(session.id);
    return { ok: true, session: await captureOpenCodeContext(client, session, result.data) };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: (error as Error).message || "Unable to re-import OpenCode context.",
    };
  }
}

export async function addOpenCodeStatus(session: DbSession, { forceRefresh = false } = {}) {
  const enriched = await ensureOpenCodeContext(session);
  const localUrl = process.env.SAY_TO_ME_OPENCODE_LOCAL_URL || null;
  const tailscaleUrl = process.env.SAY_TO_ME_OPENCODE_TAILSCALE_URL || null;
  const sessionInfo = await getOpenCodeSessionInfo(enriched.id);
  const opencodeStatus = await getOpenCodeStatus(enriched.id, { forceRefresh });
  const directory = sessionInfo?.directory || null;
  const opencodeDirB64 =
    (localUrl || tailscaleUrl) && directory ? Buffer.from(directory).toString("base64url") : null;
  const backend = detectSessionBackend(enriched.id);
  const opencodeTitle =
    backend === "opencode" || backend === "none" || backend === "voice"
      ? (sessionInfo?.title ?? null)
      : getTitleForBackend(backend, enriched.id);
  return {
    ...enriched,
    href: sessionHref(enriched.id),
    backend,
    opencodeStatus,
    opencodeTitle,
    opencodeAgent: sessionInfo?.agent ?? null,
    opencodeModelProvider: sessionInfo?.modelProvider ?? null,
    opencodeModel: sessionInfo?.model ?? null,
    opencodeDirB64,
  };
}

function getTitleForBackend(backend: string, sessionId: string): string | null {
  const layer = layerForBackend(backend);
  if (!layer) return null;
  const program = Effect.gen(function* () {
    const service = yield* SessionTitle;
    return yield* service.getTitle(sessionId);
  });
  return Effect.runSync(program.pipe(Effect.provide(layer)));
}
