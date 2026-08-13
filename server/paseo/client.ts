import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { type as arktype } from "arktype";
import { safeJsonParse } from "@say-to-me/runtime-validation";

import { getPaseoInstance, type PaseoInstance } from "../settings.ts";
import { getSession } from "../sessions.ts";
import {
  detectSessionBackend,
  paseoChatRoomUuid,
  paseoSessionUuid,
  toPaseoChatSessionId,
  toPaseoSessionId,
} from "../session-id.ts";

const PaseoSession = arktype({
  id: "string",
  "title?": "string | null",
  "cwd?": "string | null",
  "updatedAt?": "string | number | null",
  "modifiedAt?": "string | number | null",
});
const PaseoSessionList = PaseoSession.array();
const PaseoSessionEnvelope = arktype({ sessions: PaseoSessionList });
const PaseoChatRoom = arktype({
  id: "string",
  name: "string",
  "purpose?": "string | null",
  "lastMessageAt?": "string | null",
});
const PaseoChatRoomList = PaseoChatRoom.array();
const PaseoChatRoomEnvelope = arktype({ rooms: PaseoChatRoomList });

export type PaseoDiscoverableSession = {
  sessionId: string;
  chatId: string;
  title: string | null;
  modifiedAt: number | null;
  imported: boolean;
  instanceId: string;
  cwd: string | null;
};

export type PaseoCommand = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  /** Set when invoking a checkout via scripts/dev-home.sh. */
  checkoutCwd?: string;
};

export const PASEO_AGENT_ID = "say-to-me";

const PASEO_COMMAND_TIMEOUT_MS = Number(process.env.SAY_TO_ME_PASEO_COMMAND_TIMEOUT_MS || 15_000);

export class PaseoCommandError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PaseoCommandError";
  }
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

function normalizeCwd(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(expandHome(trimmed)) : null;
}

function canonicalPath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

/** Settings binPath, else SAY_TO_ME_PASEO_BIN (same fallback shape as SAY_TO_ME_T3_BIN). */
export function resolvePaseoBinPath(instance: Pick<PaseoInstance, "binPath">): string | undefined {
  const configured = instance.binPath?.trim() || process.env.SAY_TO_ME_PASEO_BIN?.trim();
  return configured || undefined;
}

/** Settings home, else SAY_TO_ME_PASEO_HOME. */
export function resolvePaseoHome(instance: Pick<PaseoInstance, "home">): string | undefined {
  const configured = instance.home?.trim() || process.env.SAY_TO_ME_PASEO_HOME?.trim();
  return configured || undefined;
}

/**
 * Checkout CLI form needs the workspace install. Broken checkouts often keep `dist/`
 * while missing root deps (e.g. express), which surfaces as opaque import 502s.
 */
export async function paseoCheckoutCliLooksRunnable(binPath: string): Promise<boolean> {
  try {
    await Promise.all([
      stat(path.join(binPath, "scripts/dev-home.sh")),
      stat(path.join(binPath, "packages/cli/src/index.ts")),
      stat(path.join(binPath, "node_modules/express/package.json")),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function packagedPaseoCommand(): Promise<string> {
  const nodeBinPaseo = path.join(path.dirname(process.execPath), "paseo");
  return stat(nodeBinPaseo)
    .then(() => nodeBinPaseo)
    .catch(() => "paseo");
}

export function paseoSessionMatchesWorkspace(
  session: Pick<PaseoDiscoverableSession, "cwd">,
  workspacePath: string,
): boolean {
  return session.cwd == null || canonicalPath(session.cwd) === canonicalPath(workspacePath);
}

export async function buildPaseoCommand(
  instance: PaseoInstance,
  args: string[],
): Promise<PaseoCommand> {
  const configured = resolvePaseoBinPath(instance);
  let command = await packagedPaseoCommand();
  let commandArgs = args;
  let checkoutCwd: string | undefined;
  if (configured) {
    const binPath = expandHome(configured);
    const info = await stat(binPath);
    if (info.isDirectory()) {
      if (await paseoCheckoutCliLooksRunnable(binPath)) {
        checkoutCwd = binPath;
        command = path.join(binPath, "scripts/dev-home.sh");
        // Only dedupe `--json` among the flags; args after a `--` terminator are
        // positionals and may legitimately equal "--json" (e.g. a chat message body).
        const terminator = args.indexOf("--");
        const flagArgs = terminator === -1 ? args : args.slice(0, terminator);
        const literalArgs = terminator === -1 ? [] : args.slice(terminator);
        commandArgs = [
          "npx",
          "tsx",
          path.join(binPath, "packages/cli/src/index.ts"),
          "--json",
          ...flagArgs.filter((arg) => arg !== "--json"),
          ...literalArgs,
        ];
      } else {
        // Prefer an explicit CLI binary override, else the packaged `paseo` on PATH.
        const envBin = process.env.SAY_TO_ME_PASEO_BIN?.trim();
        if (envBin && expandHome(envBin) !== binPath) {
          const envPath = expandHome(envBin);
          const envInfo = await stat(envPath);
          if (!envInfo.isDirectory()) command = envPath;
          else command = await packagedPaseoCommand();
        } else {
          command = await packagedPaseoCommand();
        }
      }
    } else {
      command = binPath;
    }
  }
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", PASEO_AGENT_ID };
  const home = resolvePaseoHome(instance);
  if (home) env.PASEO_HOME = expandHome(home);
  return { command, args: commandArgs, env, checkoutCwd };
}

export async function runPaseoCommand(
  instance: PaseoInstance,
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ stdout: string; stderr: string }> {
  const invocation = await buildPaseoCommand(instance, args);
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.checkoutCwd,
      env: invocation.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });
    let stdout = "";
    let stderr = "";
    const abortChild = () => {
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        // The process group already exited.
      }
    };
    options.signal?.addEventListener("abort", abortChild, { once: true });
    const settle = (result: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortChild);
      result();
    };
    const timeout = setTimeout(() => {
      try {
        if (process.platform === "win32") child.kill("SIGTERM");
        else process.kill(-child.pid!, "SIGTERM");
      } catch {
        // The process group already exited.
      }
      setTimeout(() => {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid!, "SIGKILL");
        } catch {
          // The process group already exited.
        }
      }, 1_000).unref();
      settle(() =>
        reject(
          new PaseoCommandError(
            `Paseo command timed out after ${options.timeoutMs ?? PASEO_COMMAND_TIMEOUT_MS}ms. Delivery may have been accepted; it will not be replayed automatically.`,
            false,
          ),
        ),
      );
    }, options.timeoutMs ?? PASEO_COMMAND_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", (error) =>
      settle(() => reject(new PaseoCommandError(error.message, true))),
    );
    child.once("close", (code) => {
      settle(() => {
        if (code === 0) resolve({ stdout, stderr });
        else
          reject(
            new PaseoCommandError(
              `Paseo command failed: ${stderr.trim() || stdout.trim() || `exit ${code}`}. Delivery may have been accepted; it will not be replayed automatically.`,
              false,
            ),
          );
      });
    });
  });
}

function parseModifiedAt(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function listPaseoSessions(
  instance: PaseoInstance,
): Promise<PaseoDiscoverableSession[]> {
  const { stdout } = await runPaseoCommand(instance, [
    "ls",
    "--global",
    "--json",
    "--host",
    instance.host,
  ]);
  const raw = safeJsonParse(arktype("unknown"), stdout.trim());
  const sessions =
    safeJsonParse(PaseoSessionList, JSON.stringify(raw)) ??
    safeJsonParse(PaseoSessionEnvelope, JSON.stringify(raw))?.sessions;
  if (!sessions) throw new Error("Paseo ls returned an invalid payload.");
  const discoveredSessions = sessions
    .flatMap((session) => {
      const sessionId = toPaseoSessionId(session.id);
      if (!sessionId) return [];
      return [
        {
          sessionId,
          chatId: session.id,
          title: session.title?.trim() || null,
          modifiedAt: parseModifiedAt(session.modifiedAt ?? session.updatedAt),
          imported: getSession(sessionId) != null,
          instanceId: instance.id,
          cwd: normalizeCwd(session.cwd),
        },
      ];
    })
    .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
  return discoveredSessions;
}

export async function listPaseoChatRooms(
  instance: PaseoInstance,
): Promise<PaseoDiscoverableSession[]> {
  const { stdout } = await runPaseoCommand(instance, [
    "chat",
    "ls",
    "--json",
    "--host",
    instance.host,
  ]);
  const payload = stdout.trim();
  const chats =
    safeJsonParse(PaseoChatRoomList, payload) ??
    safeJsonParse(PaseoChatRoomEnvelope, payload)?.rooms;
  if (!chats) throw new Error("Paseo chat ls returned an invalid payload.");
  return chats.flatMap((room) => {
    const sessionId = toPaseoChatSessionId(room.id);
    if (!sessionId) return [];
    return [
      {
        sessionId,
        chatId: room.id,
        title: room.name.trim() || null,
        modifiedAt: parseModifiedAt(room.lastMessageAt),
        imported: getSession(sessionId) != null,
        instanceId: instance.id,
        cwd: null,
      },
    ];
  });
}

export function paseoChatReadArgs(roomUuid: string, host: string, limit = 50): string[] {
  return ["chat", "read", "--json", "--host", host, "--limit", String(limit), roomUuid];
}

export function paseoChatWaitArgs(roomUuid: string, host: string, timeout = "30s"): string[] {
  return ["chat", "wait", "--json", "--host", host, "--timeout", timeout, roomUuid];
}

/**
 * The body is a commander positional; a `-`-leading message ("- do this") would
 * otherwise parse as an unknown option, so the `--` terminator is required.
 */
export function paseoChatPostArgs(roomUuid: string, text: string, host: string): string[] {
  return ["chat", "post", "--json", "--host", host, "--", roomUuid, text];
}

export async function dispatchPaseoMessage(input: {
  sessionId: string;
  text: string;
}): Promise<void> {
  const instanceId = getSession(input.sessionId)?.paseoInstanceId?.trim();
  if (!instanceId)
    throw new Error(`Paseo session "${input.sessionId}" has no configured instance.`);
  const instance = getPaseoInstance(instanceId);
  if (!instance) throw new Error(`Paseo instance "${instanceId}" was not found.`);
  if (detectSessionBackend(input.sessionId) === "paseo-chat") {
    await runPaseoCommand(
      instance,
      paseoChatPostArgs(paseoChatRoomUuid(input.sessionId), input.text, instance.host),
    );
    return;
  }
  const tempDir = await mkdtemp(path.join(tmpdir(), "say-to-me-paseo-"));
  const promptFile = path.join(tempDir, "prompt.txt");
  try {
    await writeFile(promptFile, input.text, { encoding: "utf8", mode: 0o600 });
    await runPaseoCommand(instance, [
      "send",
      paseoSessionUuid(input.sessionId),
      "--prompt-file",
      promptFile,
      "--no-wait",
      "--json",
      "--host",
      instance.host,
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
