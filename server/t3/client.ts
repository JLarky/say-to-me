import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { type as arktype } from "arktype";
import { Duration, Effect } from "effect";
import { safeJsonParse } from "@say-to-me/runtime-validation";

import {
  ensureT3ServerInstanceAccessTokenEffect,
  getStoredT3ServerInstance,
  makeT3AccessTokenIssuerEffect,
  T3AccessTokenError,
  T3AccessTokenStoreLive,
  type MintedT3AccessToken,
  type T3ServerInstanceStored,
} from "../settings.ts";
import { getSession } from "../sessions.ts";
import { T3_SESSION, t3SessionUuid, toT3SessionId } from "../session-id.ts";
import { normalizeWorkspacePath } from "../workspace.ts";
import { listStored } from "./instance-list.ts";

const IssuedSessionJson = arktype({
  token: "string",
  expiresAt: "string",
  "sessionId?": "string",
});

const ShellProject = arktype({
  id: "string",
  title: "string",
  workspaceRoot: "string",
});

const ShellThread = arktype({
  id: "string",
  projectId: "string",
  title: "string",
  "branch?": "string | null",
  "worktreePath?": "string | null",
  "updatedAt?": "string",
  "archivedAt?": "string | null",
});

const ShellSnapshot = arktype({
  projects: ShellProject.array(),
  threads: ShellThread.array(),
});

const T3_TOKEN_MINT_TIMEOUT_MS = 15_000;

export type T3DispatchCommand = {
  type: "thread.turn.start";
  commandId: string;
  threadId: string;
  message: {
    messageId: string;
    role: "user";
    text: string;
    attachments: [];
  };
  runtimeMode: "full-access";
  interactionMode: "default";
  deliveryMode: "when-idle";
  createdAt: string;
};

export function buildT3DispatchCommand(input: {
  threadId: string;
  messageId: number;
  text: string;
  createdAt?: string;
}): T3DispatchCommand {
  const stableId = String(input.messageId);
  return {
    type: "thread.turn.start",
    commandId: `say-to-me-${stableId}`,
    threadId: input.threadId,
    message: {
      messageId: `say-to-me-${stableId}`,
      role: "user",
      text: input.text,
      attachments: [],
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    deliveryMode: "when-idle",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export async function dispatchT3Message(input: {
  sessionId: string;
  messageId: number;
  text: string;
}): Promise<{ sequence: number }> {
  const session = getSession(input.sessionId);
  const instanceId = session?.t3InstanceId?.trim();
  if (!instanceId) {
    throw new Error(`T3 session "${input.sessionId}" has no configured instance.`);
  }
  const instance = getStoredT3ServerInstance(instanceId);
  if (!instance) throw new Error(`T3 server instance "${instanceId}" was not found.`);
  const token = await ensureAccessTokenForT3Instance(instanceId);
  const origin = normalizeOrigin(instance.originUrl);
  const response = await fetch(`${origin}/api/orchestration/dispatch`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(
      buildT3DispatchCommand({
        threadId: t3SessionUuid(input.sessionId),
        messageId: input.messageId,
        text: input.text,
      }),
    ),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `T3 dispatch failed (${response.status}): ${body.slice(0, 240) || response.statusText}`,
    );
  }
  const parsed = safeJsonParse(arktype({ sequence: "number" }), body);
  if (!parsed) throw new Error("T3 dispatch response was invalid.");
  return parsed;
}

export type T3DiscoverableSession = {
  sessionId: string;
  chatId: string;
  title: string | null;
  modifiedAt: number | null;
  imported: boolean;
  instanceId: string;
  projectId: string;
  branch: string | null;
  worktreePath: string | null;
  workspaceRoot: string | null;
};

function t3ServerBin(instance: Pick<T3ServerInstanceStored, "binPath" | "isDev">): string {
  const configured = expandHomePath(instance.binPath || "");
  if (configured) {
    return path.join(
      configured,
      instance.isDev ? "apps/server/src/bin.ts" : "apps/server/dist/bin.mjs",
    );
  }
  return (
    process.env.SAY_TO_ME_T3_BIN?.trim() ||
    path.join(homedir(), "work/t3code/apps/server/dist/bin.mjs")
  );
}

function portFromOriginUrl(originUrl: string): string {
  try {
    const url = new URL(originUrl);
    if (url.port) return url.port;
    return url.protocol === "https:" ? "443" : "80";
  } catch {
    return "5470";
  }
}

function normalizeOrigin(originUrl: string): string {
  const trimmed = originUrl.trim().replace(/\/+$/, "");
  return trimmed || "http://localhost:5470";
}

function expandHomePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return path.join(homedir(), trimmed.slice(2));
  return trimmed;
}

function defaultT3Home(): string {
  return path.join(homedir(), ".t3");
}

function canonicalPath(value: string): string {
  try {
    return realpathSync(path.resolve(value));
  } catch {
    return path.resolve(value);
  }
}

function pathsMatch(left: string, right: string): boolean {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
}

type ProcessResult = { stdout: string; stderr: string; code: number | null };

type ManagedProcess = {
  child: ReturnType<typeof spawn>;
  completion: Promise<ProcessResult>;
};

function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Effect.Effect<ProcessResult, Error> {
  const acquire = Effect.sync(() => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    let stdout = "";
    let stderr = "";
    const completion = new Promise<ProcessResult>((resolve, reject) => {
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", fail);
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        resolve({ stdout, stderr, code });
      });
    });
    return { child, completion } satisfies ManagedProcess;
  });
  const use = (process: ManagedProcess) =>
    Effect.tryPromise({
      try: () => process.completion,
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
  const release = (process: ManagedProcess) =>
    Effect.sync(() => {
      if (process.child.exitCode == null) {
        process.child.kill("SIGTERM");
        if (process.child.exitCode == null) process.child.kill("SIGKILL");
      }
    });
  return Effect.acquireUseRelease(acquire, use, release).pipe(
    Effect.timeoutFail({
      duration: Duration.millis(T3_TOKEN_MINT_TIMEOUT_MS),
      onTimeout: () =>
        new Error(`T3 auth session issue timed out after ${T3_TOKEN_MINT_TIMEOUT_MS}ms.`),
    }),
  );
}

/**
 * Mint a bearer access token for a configured T3 instance via the T3 server CLI.
 *
 * T3 stores auth under `${baseDir}/userdata` or `${baseDir}/dev`.
 * Explicit `--base-dir` always selects `userdata`. Dev servers (Vite dev URL) use
 * `dev` only when base-dir is left implicit and a dev URL is present — so for
 * `isDev` we set T3CODE_HOME / omit --base-dir and pass --dev-url.
 */
function mintT3AccessTokenForInstanceEffect(
  instance: Pick<T3ServerInstanceStored, "binPath" | "baseDir" | "originUrl" | "isDev">,
): Effect.Effect<MintedT3AccessToken, Error> {
  const baseDir = expandHomePath(instance.baseDir || defaultT3Home());
  const originUrl = normalizeOrigin(instance.originUrl);
  const isDev = instance.isDev === true;
  if (!baseDir)
    return Effect.fail(new Error("T3 instance baseDir is required to mint an access token."));
  if (!originUrl)
    return Effect.fail(new Error("T3 instance originUrl is required to mint an access token."));

  const bin = t3ServerBin(instance);
  const port = portFromOriginUrl(originUrl);
  const devUrl = originUrl.endsWith("/") ? originUrl : `${originUrl}/`;
  const args = ["auth", "session", "issue", "--ttl", "1h", "--label", "stm-api", "--json"];
  if (isDev) {
    // Match servers started with a Vite dev URL: state under baseDir/dev.
    // Do not pass --base-dir (explicit base-dir forces the `userdata` subdir).
    args.push("--dev-url", devUrl);
  } else {
    // Explicit base-dir → T3 uses baseDir/userdata (production/stable).
    args.push("--base-dir", baseDir);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    T3CODE_PORT: port,
    NO_COLOR: "1",
  };
  if (isDev) {
    env.VITE_DEV_SERVER_URL = devUrl;
    // Only override home when it differs from the T3 default (~/.t3). Setting
    // T3CODE_HOME to the default path has been observed to mint unusable tokens.
    if (canonicalPath(baseDir) !== canonicalPath(defaultT3Home())) {
      env.T3CODE_HOME = baseDir;
    } else {
      delete env.T3CODE_HOME;
    }
  }

  return runProcess(process.execPath, [bin, ...args], env).pipe(
    Effect.flatMap((result) => {
      if (result.code !== 0) {
        const detail = (result.stderr || result.stdout).trim() || `exit ${result.code}`;
        return Effect.fail(new Error(`T3 auth session issue failed: ${detail}`));
      }
      const parsed = safeJsonParse(IssuedSessionJson, result.stdout.trim());
      if (!parsed?.token?.trim() || !parsed.expiresAt) {
        return Effect.fail(new Error("T3 auth session issue returned an invalid payload."));
      }
      const expiresAt = Date.parse(parsed.expiresAt);
      if (!Number.isFinite(expiresAt)) {
        return Effect.fail(
          new Error(`T3 auth session issue returned a bad expiresAt: ${parsed.expiresAt}`),
        );
      }
      return Effect.succeed({ accessToken: parsed.token.trim(), accessTokenExpiresAt: expiresAt });
    }),
  );
}

export async function mintT3AccessTokenForInstance(
  instance: Pick<T3ServerInstanceStored, "binPath" | "baseDir" | "originUrl" | "isDev">,
): Promise<MintedT3AccessToken> {
  return Effect.runPromise(mintT3AccessTokenForInstanceEffect(instance));
}

export async function ensureAccessTokenForT3Instance(instanceId: string): Promise<string> {
  return Effect.runPromise(ensureAccessTokenForT3InstanceEffect(instanceId));
}

function ensureAccessTokenForT3InstanceEffect(instanceId: string): Effect.Effect<string, Error> {
  const instance = getStoredT3ServerInstance(instanceId);
  if (!instance) {
    return Effect.fail(new Error(`T3 server instance "${instanceId}" was not found.`));
  }
  return ensureT3ServerInstanceAccessTokenEffect(instanceId).pipe(
    Effect.provide(makeT3AccessTokenIssuerEffect(mintT3AccessTokenForInstanceEffect(instance))),
    Effect.provide(T3AccessTokenStoreLive),
    Effect.mapError((error) =>
      error instanceof T3AccessTokenError ? new Error(error.error) : new Error(String(error)),
    ),
  );
}

export async function fetchT3ShellSnapshot(
  instance: Pick<T3ServerInstanceStored, "originUrl">,
  accessToken: string,
): Promise<typeof ShellSnapshot.infer> {
  const origin = normalizeOrigin(instance.originUrl);
  const response = await fetch(`${origin}/api/orchestration/shell`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `T3 shell snapshot failed (${response.status}): ${text.slice(0, 240) || response.statusText}`,
    );
  }
  const parsed = safeJsonParse(ShellSnapshot, text);
  if (!parsed) {
    throw new Error("T3 shell snapshot response was invalid.");
  }
  return parsed;
}

export type DiscoverT3SessionsResult =
  | { ok: true; path: string; instanceId: string; sessions: T3DiscoverableSession[] }
  | { ok: false; error: string };

/**
 * List T3 threads for a checkout path using a configured instance.
 * Filters shell threads whose project workspaceRoot matches the checkout.
 */
export function discoverT3SessionsForPathEffect(
  instanceId: string,
  workspacePath: string,
): Effect.Effect<DiscoverT3SessionsResult> {
  const targetPath = normalizeWorkspacePath(workspacePath);
  if (!targetPath) return Effect.succeed({ ok: false, error: "Enter a folder path." });

  const instance = getStoredT3ServerInstance(instanceId);
  if (!instance) {
    return Effect.succeed({
      ok: false,
      error: `T3 server instance "${instanceId}" was not found.`,
    });
  }
  if (!instance.baseDir.trim()) {
    return Effect.succeed({ ok: false, error: `T3 instance "${instanceId}" is missing baseDir.` });
  }
  if (!instance.originUrl.trim()) {
    return Effect.succeed({
      ok: false,
      error: `T3 instance "${instanceId}" is missing originUrl.`,
    });
  }

  return Effect.gen(function* () {
    const token = yield* ensureAccessTokenForT3InstanceEffect(instanceId);
    const shell = yield* Effect.tryPromise({
      try: () => fetchT3ShellSnapshot(instance, token),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    const projectsById = new Map(shell.projects.map((project) => [project.id, project]));
    const sessions: T3DiscoverableSession[] = [];

    for (const thread of shell.threads) {
      if (thread.archivedAt) continue;
      const project = projectsById.get(thread.projectId);
      const workspaceRoot = project?.workspaceRoot ?? null;
      const worktreePath = thread.worktreePath ?? null;
      const matchesCheckout =
        (workspaceRoot != null && pathsMatch(workspaceRoot, targetPath)) ||
        (worktreePath != null && pathsMatch(worktreePath, targetPath));
      if (!matchesCheckout) continue;

      const sessionId = toT3SessionId(thread.id);
      if (!sessionId) continue;
      const modifiedAt = thread.updatedAt ? Date.parse(thread.updatedAt) : null;

      sessions.push({
        sessionId,
        chatId: thread.id,
        title: thread.title?.trim() || null,
        modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : null,
        imported: getSession(sessionId) != null,
        instanceId,
        projectId: thread.projectId,
        branch: thread.branch ?? null,
        worktreePath,
        workspaceRoot,
      });
    }

    sessions.sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
    return {
      ok: true as const,
      path: targetPath,
      instanceId,
      sessions,
    };
  }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        ok: false as const,
        error: error instanceof Error ? error.message : "Unable to discover T3 threads.",
      }),
    ),
  );
}

export async function discoverT3SessionsForPath(
  instanceId: string,
  workspacePath: string,
): Promise<DiscoverT3SessionsResult> {
  return Effect.runPromise(discoverT3SessionsForPathEffect(instanceId, workspacePath));
}

export function findT3ThreadAcrossInstancesEffect(
  threadId: string,
  instanceId?: string,
): Effect.Effect<
  {
    instance: T3ServerInstanceStored;
    thread: typeof ShellThread.infer;
    project: typeof ShellProject.infer | null;
  } | null,
  Error
> {
  const chatId = threadId.startsWith(T3_SESSION.prefix)
    ? threadId.slice(T3_SESSION.prefix.length)
    : threadId;
  return Effect.gen(function* () {
    for (const instance of listStored()) {
      if (instanceId && instance.id !== instanceId) continue;
      const result = yield* ensureAccessTokenForT3InstanceEffect(instance.id).pipe(
        Effect.flatMap((token) =>
          Effect.tryPromise({
            try: () => fetchT3ShellSnapshot(instance, token),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          }),
        ),
        Effect.map((shell) => ({ ok: true as const, shell })),
        Effect.catchAll((error) => Effect.succeed({ ok: false as const, error })),
      );
      if (!result.ok) {
        if (instanceId) {
          const detail =
            result.error instanceof Error ? result.error.message : "Unknown T3 instance error.";
          return yield* Effect.fail(
            new Error(`Unable to reach T3 instance "${instance.id}": ${detail}`),
          );
        }
        continue;
      }
      const thread = result.shell.threads.find((entry) => entry.id === chatId);
      if (!thread || thread.archivedAt) continue;
      const project = result.shell.projects.find((entry) => entry.id === thread.projectId) ?? null;
      return { instance, thread, project };
    }
    return null;
  });
}

export async function findT3ThreadAcrossInstances(
  threadId: string,
  instanceId?: string,
): Promise<{
  instance: T3ServerInstanceStored;
  thread: typeof ShellThread.infer;
  project: typeof ShellProject.infer | null;
} | null> {
  return Effect.runPromise(findT3ThreadAcrossInstancesEffect(threadId, instanceId));
}
