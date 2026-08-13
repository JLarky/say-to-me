import { describe, expect, it } from "vite-plus/test";
import type { PrototypeRepo } from "./new-space-prototype.ts";
import {
  agentCreateButtonLabel,
  gitPickerEmptyMessage,
  gitPickerEyebrow,
  gitPickerTitle,
  knownRepositoriesFromSpaces,
  needsRepositoryPickerForWorktree,
  repositoriesForGitPicker,
  resolveWorktreeBaseRef,
  shouldShowAttachRepositoryInGitPicker,
  worktreeCreateButtonLabel,
} from "./space-worktree-create.ts";

function repo(id: string, name: string, extra: Partial<PrototypeRepo> = {}): PrototypeRepo {
  return { id, name, path: `/repos/${name}`, worktrees: [], ...extra };
}

describe("needsRepositoryPickerForWorktree", () => {
  it("requires a picker when no repository is selected in the space", () => {
    expect(needsRepositoryPickerForWorktree(null)).toBe(true);
  });

  it("skips the picker when a concrete repository is already selected", () => {
    expect(needsRepositoryPickerForWorktree("repo-1")).toBe(false);
  });
});

describe("worktreeCreateButtonLabel", () => {
  it("asks to choose a repository when none is selected", () => {
    expect(worktreeCreateButtonLabel(null)).toBe("Choose repository for new worktree");
  });

  it("uses the direct create label when a repository is selected", () => {
    expect(worktreeCreateButtonLabel("repo-1")).toBe("New worktree");
  });
});

describe("agentCreateButtonLabel", () => {
  it("asks to choose a git context when none is selected", () => {
    expect(agentCreateButtonLabel(null)).toBe("Choose context for new agent");
  });

  it("uses the direct create label when a repository is selected", () => {
    expect(agentCreateButtonLabel("repo-1")).toBe("New agent");
  });
});

describe("git picker copy for new-worktree", () => {
  it("labels the picker as a repository choice for new worktrees", () => {
    expect(gitPickerEyebrow("new-worktree")).toBe("NEW WORKTREE");
    expect(gitPickerTitle("new-worktree")).toBe("Choose repository");
  });

  it("labels the picker for new agents like new session", () => {
    expect(gitPickerEyebrow("new-agent")).toBe("NEW AGENT");
    expect(gitPickerTitle("new-agent")).toBe("Choose Git context");
  });

  it("keeps existing session and browse copy", () => {
    expect(gitPickerEyebrow("new-session")).toBe("NEW SESSION");
    expect(gitPickerTitle("new-session")).toBe("Choose Git context");
    expect(gitPickerEyebrow("browse")).toBe("GIT CONTEXT");
    expect(gitPickerTitle("browse")).toBe("Repository & worktree");
  });
});

describe("knownRepositoriesFromSpaces", () => {
  it("dedupes the same repository attached to multiple spaces", () => {
    const shared = repo("repo-say", "say-to-me");
    const known = knownRepositoriesFromSpaces([
      { repos: [shared] },
      { repos: [shared, repo("repo-other", "other")] },
      { repos: [] },
    ]);
    expect(known.map((item) => item.id)).toEqual(["repo-other", "repo-say"]);
  });
});

describe("repositoriesForGitPicker", () => {
  it("uses app-known repositories for new-worktree, space repos for session and agent", () => {
    const spaceRepos = [repo("space-only", "local")];
    const knownRepos = [repo("repo-say", "say-to-me")];
    expect(repositoriesForGitPicker("new-worktree", spaceRepos, knownRepos)).toEqual(knownRepos);
    expect(repositoriesForGitPicker("new-agent", spaceRepos, knownRepos)).toEqual(spaceRepos);
    expect(repositoriesForGitPicker("new-session", spaceRepos, knownRepos)).toEqual(spaceRepos);
    expect(repositoriesForGitPicker("browse", spaceRepos, knownRepos)).toEqual(spaceRepos);
  });
});

describe("git picker attach affordance and empty copy", () => {
  it("offers Attach repository for browse and new-worktree only", () => {
    expect(shouldShowAttachRepositoryInGitPicker("browse")).toBe(true);
    expect(shouldShowAttachRepositoryInGitPicker("new-worktree")).toBe(true);
    expect(shouldShowAttachRepositoryInGitPicker("new-agent")).toBe(false);
    expect(shouldShowAttachRepositoryInGitPicker("new-session")).toBe(false);
  });

  it("explains the true empty known-repo case for new-worktree only", () => {
    expect(
      gitPickerEmptyMessage({
        purpose: "new-worktree",
        hasSearch: false,
        knownRepoCount: 0,
      }),
    ).toBe("No repositories known yet. Attach a local Git repository to continue.");
    expect(
      gitPickerEmptyMessage({
        purpose: "new-agent",
        hasSearch: false,
        knownRepoCount: 0,
      }),
    ).toBe("No matching repositories or worktrees");
    expect(
      gitPickerEmptyMessage({
        purpose: "new-worktree",
        hasSearch: true,
        knownRepoCount: 0,
      }),
    ).toBe("No matching repositories or worktrees");
  });
});

describe("resolveWorktreeBaseRef", () => {
  it("keeps the full branch from the source checkout before attach", () => {
    const source = repo("repo-say", "say-to-me", {
      primaryBranch: "main",
      worktrees: ["foo"],
      worktreeBranches: { foo: "feature/foo" },
    });
    expect(resolveWorktreeBaseRef(source, "foo")).toBe("feature/foo");
  });

  it("reads available-worktree branch maps the same way", () => {
    const source = repo("repo-say", "say-to-me", {
      primaryBranch: "main",
      availableWorktrees: ["bar"],
      availableWorktreeBranches: { bar: "feature/bar" },
    });
    expect(resolveWorktreeBaseRef(source, "bar")).toBe("feature/bar");
  });

  it("uses the primary branch for primary checkout or missing key", () => {
    const source = repo("repo-say", "say-to-me", { primaryBranch: "main" });
    expect(resolveWorktreeBaseRef(source, "__primary__")).toBe("main");
    expect(resolveWorktreeBaseRef(source, null)).toBe("main");
  });
});
