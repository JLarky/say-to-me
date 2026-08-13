import type { CodexReasoningEffort } from "./codex-reasoning-effort.ts";
import type { PrototypeRepo, PrototypeSpacesState } from "./new-space-prototype.ts";
import { claimSession, createWorktree } from "./spaces-api.ts";
import { createProviderSession, type CreateProvider } from "./session-creation-api.ts";

/** Stable 8-char id so branch names can retarget when the provider changes. */
export function newAgentBranchId(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID().replaceAll("-", "").slice(0, 8);
  }
  const bytes = new Uint8Array(4);
  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Auto branch for agent worktrees — Cursor Cloud style, no name field. */
export function suggestAgentBranch(
  provider: CreateProvider,
  id: string = newAgentBranchId(),
): string {
  return `agent/${provider}-${id}`;
}

/**
 * Sentinel for "use the remote's default branch" (origin/HEAD → main/develop/…).
 * createGitWorktree resolves this before fetch + worktree add.
 */
export const AGENT_REMOTE_DEFAULT_BASE = "origin/HEAD";

/** Effective git base ref for createWorktree (`-b` start point). */
export function resolveAgentBase(selectedBase: string, useRemoteDefault: boolean): string {
  return useRemoteDefault ? AGENT_REMOTE_DEFAULT_BASE : selectedBase;
}

export function worktreeFolderNameFromBranch(branch: string): string {
  return branch.split("/").filter(Boolean).at(-1) ?? branch;
}

/** Locate the checkout path after a spaces `createWorktree` mutation. */
export function findCreatedWorktreePath(repo: PrototypeRepo, branch: string): string | null {
  const folder = worktreeFolderNameFromBranch(branch);
  const match =
    repo.worktrees.find((worktree) => repo.worktreeBranches?.[worktree] === branch) ??
    (repo.worktrees.includes(folder) ? folder : undefined);
  if (!match) return null;
  return repo.worktreePaths?.[match] ?? null;
}

export function resolveAgentWorktreePath(
  state: PrototypeSpacesState,
  spaceId: string,
  repoId: string,
  branch: string,
): string {
  const space = state.spaces.find((item) => item.id === spaceId);
  const repo = space?.repos.find((item) => item.id === repoId);
  if (!repo) throw new Error("Repository missing after worktree create.");
  const path = findCreatedWorktreePath(repo, branch);
  if (!path) throw new Error("Created worktree path was not found.");
  return path;
}

export type AgentWorktreeProgress = {
  worktreePath?: string;
  sessionId?: string;
  state?: PrototypeSpacesState;
};

export async function createAgentWorktreeSession(input: {
  spaceId: string;
  repoId: string;
  branch: string;
  base: string;
  parentPath: string;
  provider: CreateProvider;
  modelID: string;
  reasoningEffort: CodexReasoningEffort | "";
  /** Resume after a partial success (worktree already exists). */
  worktreePath?: string | null;
  /** Resume after session create but before claim. */
  sessionId?: string | null;
  onProgress?: (progress: AgentWorktreeProgress) => void;
}): Promise<{
  state: PrototypeSpacesState;
  sessionId: string;
  worktreePath: string;
  branch: string;
}> {
  let worktreePath = input.worktreePath?.trim() || null;
  let sessionId = input.sessionId?.trim() || null;

  if (!worktreePath) {
    const created = await createWorktree(
      input.spaceId,
      input.repoId,
      input.branch,
      input.base,
      input.parentPath,
    );
    worktreePath = resolveAgentWorktreePath(
      created.state,
      input.spaceId,
      input.repoId,
      input.branch,
    );
    input.onProgress?.({ worktreePath, state: created.state });
  }

  if (!sessionId) {
    sessionId = await createProviderSession(
      input.provider,
      worktreePath,
      input.modelID,
      input.reasoningEffort,
    );
    input.onProgress?.({ worktreePath, sessionId });
  }

  const claimed = await claimSession(input.spaceId, sessionId);
  return {
    state: claimed.state,
    sessionId,
    worktreePath,
    branch: input.branch,
  };
}
