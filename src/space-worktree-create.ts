import type { PrototypeRepo } from "./new-space-prototype.ts";

export type GitPickerPurpose = "browse" | "new-session" | "import" | "new-worktree" | "new-agent";

/** True when the space is on "all git contexts" (no concrete repo selected). */
export function needsRepositoryPickerForWorktree(selectedRepoId: string | null): boolean {
  return selectedRepoId === null;
}

export function worktreeCreateButtonLabel(selectedRepoId: string | null): string {
  return needsRepositoryPickerForWorktree(selectedRepoId)
    ? "Choose repository for new worktree"
    : "New worktree";
}

export function agentCreateButtonLabel(selectedRepoId: string | null): string {
  return needsRepositoryPickerForWorktree(selectedRepoId)
    ? "Choose context for new agent"
    : "New agent";
}

export function gitPickerEyebrow(purpose: GitPickerPurpose): string {
  if (purpose === "new-session") return "NEW SESSION";
  if (purpose === "import") return "IMPORT SESSION";
  if (purpose === "new-worktree") return "NEW WORKTREE";
  if (purpose === "new-agent") return "NEW AGENT";
  return "GIT CONTEXT";
}

export function gitPickerTitle(purpose: GitPickerPurpose): string {
  if (purpose === "new-session" || purpose === "import" || purpose === "new-agent") {
    return "Choose Git context";
  }
  if (purpose === "new-worktree") return "Choose repository";
  return "Repository & worktree";
}

/** Deduped repositories attached to any space — the app-wide known set. */
export function knownRepositoriesFromSpaces(
  spaces: Array<{ repos: PrototypeRepo[] }>,
): PrototypeRepo[] {
  const byId = new Map<string, PrototypeRepo>();
  for (const space of spaces) {
    for (const repo of space.repos) {
      if (!byId.has(repo.id)) byId.set(repo.id, repo);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * New worktree must not be limited to the current space's attachments — a
 * fresh space needs to pick (and then attach) a repo known elsewhere.
 * New agent / session / import use this space's attachments only.
 */
export function repositoriesForGitPicker(
  purpose: GitPickerPurpose,
  spaceRepos: PrototypeRepo[],
  knownRepos: PrototypeRepo[],
): PrototypeRepo[] {
  return purpose === "new-worktree" ? knownRepos : spaceRepos;
}

export function shouldShowAttachRepositoryInGitPicker(purpose: GitPickerPurpose): boolean {
  return purpose === "browse" || purpose === "new-worktree";
}

export function gitPickerEmptyMessage(args: {
  purpose: GitPickerPurpose;
  hasSearch: boolean;
  knownRepoCount: number;
}): string {
  if (args.purpose === "new-worktree" && !args.hasSearch && args.knownRepoCount === 0) {
    return "No repositories known yet. Attach a local Git repository to continue.";
  }
  return "No matching repositories or worktrees";
}

/**
 * Resolve the Git base ref from the *source* repo view before attach.
 * After attach, a fresh space only has the main checkout, so looking up a
 * short worktree label (e.g. "foo") on the attached repo would lose the full
 * branch (e.g. "feature/foo").
 */
export function resolveWorktreeBaseRef(
  sourceRepo: PrototypeRepo,
  worktreeKey: string | null | undefined,
  primaryCheckout = "__primary__",
): string {
  if (!worktreeKey || worktreeKey === primaryCheckout) {
    return sourceRepo.primaryBranch ?? sourceRepo.worktrees[0] ?? "main";
  }
  const mapped =
    sourceRepo.worktreeBranches?.[worktreeKey] ??
    sourceRepo.availableWorktreeBranches?.[worktreeKey];
  if (mapped === "(detached)") return "Detached HEAD";
  if (mapped) return mapped;
  return worktreeKey;
}
