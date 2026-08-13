import { describe, expect, it } from "vite-plus/test";
import {
  base64UrlDecode,
  base64UrlEncode,
  cliContextLabel,
  compactLinkLabel,
  existingContextHref,
  importSessionsHref,
  openCodeContextLabel,
  openCodeWorkspaceKey,
  projectIdentity,
  recentMessageLinks,
  recentMessageSessions,
  sessionsHref,
  workspaceFilterHref,
} from "./utils.ts";
import type { Message } from "./types.ts";

function message(overrides: Partial<Message>): Message {
  return {
    id: 1,
    text: "Long agent message",
    status: "speaking",
    author: "agent",
    sessionId: "default",
    ...overrides,
  };
}

describe("projectIdentity", () => {
  it("bases markers on session id instead of title", () => {
    const first = projectIdentity({
      id: "ses_6f7ff81a35dfGuQ6ZVL7cSlhhM",
      opencodeTitle: "segment-infra",
    });
    const renamed = projectIdentity({
      id: "ses_6f7ff81a35dfGuQ6ZVL7cSlhhM",
      opencodeTitle: "say-to-me",
    });

    expect({ color: renamed.color, icon: renamed.icon }).toEqual({
      color: first.color,
      icon: first.icon,
    });
    expect(renamed.label).toBe("say-to-me");
  });

  it("varies markers between different session ids", () => {
    expect(
      projectIdentity({ id: "ses_6f7ff81a35dfGuQ6ZVL7cSlhhM", opencodeTitle: "segment-infra" }),
    ).not.toMatchObject(
      projectIdentity({ id: "ses_72a3bd0b1e24kkoCn9yX0fQU0i", opencodeTitle: "segment-infra" }),
    );
  });
});

describe("openCodeContextLabel", () => {
  it("combines the project name with the worktree-session directory basename", () => {
    expect(
      openCodeContextLabel({
        opencodeProjectName: "opencode",
        opencodeWorktree: "/Users/dev/opencode",
        opencodeDirectory: "/Users/dev/opencode/.worktrees/eager-harbor",
      })?.segments,
    ).toEqual([
      { text: "opencode", kind: "project" },
      { text: "eager-harbor", kind: "workspace" },
    ]);
  });

  it("prefers the short worktree folder name over the git branch for the workspace segment", () => {
    expect(
      openCodeContextLabel({
        opencodeProjectName: "opencode",
        opencodeBranch: "opencode/eager-harbor",
        opencodeWorktree: "/Users/dev/opencode",
        opencodeDirectory: "/Users/dev/opencode/.worktrees/eager-harbor",
      })?.segments,
    ).toEqual([
      { text: "opencode", kind: "project" },
      { text: "eager-harbor", kind: "workspace" },
    ]);
  });

  it("falls back to the directory basename when no branch is captured", () => {
    expect(
      openCodeContextLabel({
        opencodeProjectName: "opencode",
        opencodeBranch: null,
        opencodeWorktree: "/Users/dev/opencode",
        opencodeDirectory: "/Users/dev/opencode/.worktrees/eager-harbor",
      })?.segments,
    ).toEqual([
      { text: "opencode", kind: "project" },
      { text: "eager-harbor", kind: "workspace" },
    ]);
  });

  it("hides the branch as a workspace segment when the directory equals the worktree", () => {
    const result = openCodeContextLabel({
      opencodeProjectName: null,
      opencodeProjectId: "de4029bf64ed579e8e8514a0007656fedf949b90",
      opencodeWorkspaceId: null,
      opencodeWorktree: "/Users/jlarky/vm/JLarky/gha-ts",
      opencodeDirectory: "/Users/jlarky/vm/JLarky/gha-ts",
      opencodeBranch: "bump-checkout-action-v5",
    });
    expect(result?.segments).toEqual([{ text: "gha-ts", kind: "project" }]);
    expect(result?.title).toContain("branch: bump-checkout-action-v5");
    expect(JSON.stringify(result?.segments)).not.toContain("bump-checkout-action-v5");
  });

  it("shows the workspace segment for a real worktree (directory differs from worktree)", () => {
    const result = openCodeContextLabel({
      opencodeProjectName: null,
      opencodeProjectId: "e26bde43e7a52e5704b7b5745fdbc9392e11ee29",
      opencodeWorkspaceId: null,
      opencodeWorktree: "/home/jlarky.guest/work/demo-project",
      opencodeDirectory:
        "/home/jlarky.guest/.local/share/opencode/worktree/524c44276d6329c03ca36582ce533f30d3eb93f6/eager-harbor",
      opencodeBranch: null,
    });
    expect(result?.segments).toEqual([
      { text: "demo-project", kind: "project" },
      { text: "eager-harbor", kind: "workspace" },
    ]);
  });

  it("synthesizes workspace-<shortId> when a distinct workspace has neither a directory nor a branch", () => {
    const result = openCodeContextLabel({
      opencodeProjectName: "demo-project",
      opencodeWorkspaceId: "wrk_a1b2c3d4e5f6",
      opencodeWorktree: "/home/dev/demo-project",
      opencodeDirectory: null,
      opencodeBranch: null,
    });
    expect(result?.segments).toEqual([
      { text: "demo-project", kind: "project" },
      { text: "workspace-a1b2c3", kind: "workspace" },
    ]);
  });

  it("prefers the branch over the synthetic workspace id when a distinct workspace has a branch but no directory", () => {
    const result = openCodeContextLabel({
      opencodeProjectName: "demo-project",
      opencodeWorkspaceId: "wrk_a1b2c3d4e5f6",
      opencodeWorktree: "/home/dev/demo-project",
      opencodeDirectory: null,
      opencodeBranch: "my-feature",
    });
    expect(result?.segments).toEqual([
      { text: "demo-project", kind: "project" },
      { text: "my-feature", kind: "workspace" },
    ]);
  });

  it("uses the worktree basename for the project segment, never the raw id", () => {
    const result = openCodeContextLabel({
      opencodeProjectName: null,
      opencodeProjectId: "e26bde43e7a52e5704b7b5745fdbc9392e11ee29",
      opencodeWorktree: "/Users/dev/demo-project",
      opencodeDirectory: "/Users/dev/demo-project",
    });
    expect(result?.segments).toEqual([{ text: "demo-project", kind: "project" }]);
    expect(JSON.stringify(result?.segments)).not.toContain("e26bde43");
  });

  it("surfaces the raw project id only in the tooltip", () => {
    const result = openCodeContextLabel({
      opencodeProjectName: "say-to-me",
      opencodeProjectId: "prj_abc123",
      opencodeWorktree: "/srv/work/say-to-me",
      opencodeDirectory: "/srv/work/checkout-flow",
    });
    expect(result?.segments).toEqual([
      { text: "say-to-me", kind: "project" },
      { text: "checkout-flow", kind: "workspace" },
    ]);
    expect(result?.title).toBe("say-to-me / checkout-flow (prj_abc123)");
  });

  it("dedupes when the directory basename matches the project name", () => {
    expect(
      openCodeContextLabel({
        opencodeProjectName: "say-to-me",
        opencodeDirectory: "/Users/jlarky/vm/JLarky/say-to-me",
      })?.segments,
    ).toEqual([{ text: "say-to-me", kind: "project" }]);
  });

  it("falls back to the raw project id only when nothing else is usable", () => {
    expect(
      openCodeContextLabel({
        opencodeProjectName: null,
        opencodeProjectId: "prj_lastresort",
        opencodeWorktree: null,
        opencodeDirectory: null,
      }),
    ).toMatchObject({
      segments: [{ text: "prj_lastresort", kind: "project" }],
      title: "prj_lastresort",
    });
  });

  it("keeps long segment text intact (overflow is handled in CSS, not the data)", () => {
    const longDir = `/Users/dev/${"a".repeat(60)}`;
    const result = openCodeContextLabel({
      opencodeProjectName: "project",
      opencodeWorktree: "/Users/dev/project-root",
      opencodeDirectory: longDir,
    });
    expect(result?.segments).toEqual([
      { text: "project", kind: "project" },
      { text: "a".repeat(60), kind: "workspace" },
    ]);
    expect(result?.title).toContain("a".repeat(60));
  });

  it("returns null when no OpenCode context fields are present", () => {
    expect(openCodeContextLabel({})).toBeNull();
    expect(
      openCodeContextLabel({
        opencodeProjectName: null,
        opencodeProjectId: null,
        opencodeWorktree: null,
        opencodeDirectory: null,
      }),
    ).toBeNull();
  });
});

describe("cliContextLabel", () => {
  const llmUsageCwd = "/Users/jlarky/vm/JLarky/llm-usage";

  it("builds a Cursor folder label and sessions href for external CLI sessions", () => {
    expect(
      cliContextLabel({
        backend: "cursor",
        cwd: llmUsageCwd,
      }),
    ).toEqual({
      providerLabel: "Cursor",
      folderLabel: "llm-usage",
      href: sessionsHref(llmUsageCwd),
      title: `Cursor / llm-usage (${llmUsageCwd})`,
    });
  });

  it("skips external CLI sessions that already have an OpenCode context badge", () => {
    expect(
      cliContextLabel({
        backend: "cursor",
        cwd: llmUsageCwd,
        opencodeProjectId: "global",
        opencodeDirectory: llmUsageCwd,
      }),
    ).toBeNull();
  });

  it("returns null without cwd or for non-external-cli backends", () => {
    expect(
      cliContextLabel({
        backend: "cursor",
      }),
    ).toBeNull();
    expect(
      cliContextLabel({
        backend: "opencode",
        cwd: llmUsageCwd,
      }),
    ).toBeNull();
  });
});

describe("recentMessageLinks", () => {
  it("returns the three newest unique links", () => {
    expect(
      recentMessageLinks([
        message({ id: 1, createdAt: "2026-05-14 10:00:00", links: ["https://old.example"] }),
        message({ id: 3, createdAt: "2026-05-14 12:00:00", links: ["https://new.example"] }),
        message({ id: 2, createdAt: "2026-05-14 11:00:00", links: ["https://mid.example"] }),
        message({ id: 4, createdAt: "2026-05-14 13:00:00", links: ["https://new.example"] }),
      ]),
    ).toEqual(["https://new.example", "https://mid.example", "https://old.example"]);
  });
});

describe("recentMessageSessions", () => {
  it("returns the three newest unique mentioned sessions", () => {
    expect(
      recentMessageSessions([
        message({
          id: 1,
          createdAt: "2026-05-14 10:00:00",
          sessions: [{ id: "ses_b32a81376ae3lXNMTRLCzBMmRT", alias: "Old" }],
        }),
        message({
          id: 3,
          createdAt: "2026-05-14 12:00:00",
          sessions: [{ id: "ses_5b8231acbc72AhkUb5Whz0E0DM", alias: "New" }],
        }),
        message({
          id: 2,
          createdAt: "2026-05-14 11:00:00",
          sessions: [{ id: "ses_d4258cc70146jnW4TVd6Ak5KXC", title: "Middle" }],
        }),
        message({
          id: 4,
          createdAt: "2026-05-14 13:00:00",
          sessions: [
            { id: "ses_5b8231acbc72AhkUb5Whz0E0DM", alias: "Newer duplicate" },
            { id: "ses_2f169e4e463aAcZ1L7s7gNImXq", title: "Latest" },
          ],
        }),
      ]),
    ).toEqual([
      { id: "ses_5b8231acbc72AhkUb5Whz0E0DM", alias: "Newer duplicate" },
      { id: "ses_2f169e4e463aAcZ1L7s7gNImXq", title: "Latest" },
      { id: "ses_d4258cc70146jnW4TVd6Ak5KXC", title: "Middle" },
    ]);
  });

  it("excludes the current session while keeping other recent sessions", () => {
    expect(
      recentMessageSessions(
        [
          message({
            id: 2,
            createdAt: "2026-05-14 12:00:00",
            sessions: [
              { id: "ses_a8dd2cc9858bM3n8yICU2IYmto", alias: "This session" },
              { id: "ses_639753befdf6wDbqip9t5rYV7Z", alias: "Other session" },
            ],
          }),
          message({
            id: 1,
            createdAt: "2026-05-14 11:00:00",
            sessions: [{ id: "ses_a8dd2cc9858bM3n8yICU2IYmto", alias: "Older self" }],
          }),
        ],
        3,
        "ses_a8dd2cc9858bM3n8yICU2IYmto",
      ),
    ).toEqual([{ id: "ses_639753befdf6wDbqip9t5rYV7Z", alias: "Other session" }]);
  });
});

describe("compactLinkLabel", () => {
  it("decodes and shortens long URL labels", () => {
    expect(
      compactLinkLabel(
        "https://ru.wikipedia.org/wiki/%D0%A1%D0%BF%D0%B8%D1%81%D0%BE%D0%BA_%D0%BF%D0%B5%D1%80%D1%81%D0%BE%D0%BD%D0%B0%D0%B6%D0%B5%D0%B9",
        32,
      ),
    ).toBe("ru.wikipedia.org/wiki/Список_пе…");
  });
});

describe("existingContextHref", () => {
  type Ctx = Parameters<typeof existingContextHref>[0][number];
  const session = (overrides: Partial<Ctx>): Ctx => ({
    id: "ses_ff03000e647805ix8IqxyDL5i7",
    opencodeProjectId: null,
    opencodeWorkspaceId: null,
    opencodeDirectory: null,
    opencodeWorktree: null,
    ...overrides,
  });

  it("routes a distinct-workspace directory match to its workspace page", () => {
    const s = session({
      id: "ses_2485070bd87c5MxudPboZqkmEm",
      opencodeProjectId: "prj_demo",
      opencodeDirectory: "/home/dev/wt/eager-harbor",
      opencodeWorktree: "/home/dev/Downloads/project1",
    });
    const key = openCodeWorkspaceKey(s);
    expect(existingContextHref([s], "/home/dev/wt/eager-harbor")).toBe(
      workspaceFilterHref("prj_demo", key!),
    );
  });

  it("routes a workspaceID-keyed match to its workspace page even at the project root", () => {
    const s = session({
      id: "ses_d345e81b7a888zffT5C15UO85v",
      opencodeProjectId: "prj_demo",
      opencodeWorkspaceId: "wrk_1",
      opencodeDirectory: "/home/dev/Downloads/project1",
      opencodeWorktree: "/home/dev/Downloads/project1",
    });
    expect(existingContextHref([s], "/home/dev/Downloads/project1")).toBe(
      workspaceFilterHref("prj_demo", "wrk_1"),
    );
  });

  it("routes a plain project-root match to the project page", () => {
    const s = session({
      id: "ses_17b0b19b07d3EN2qvizW22sFTH",
      opencodeProjectId: "prj_demo",
      opencodeDirectory: "/home/dev/Downloads/project1",
      opencodeWorktree: "/home/dev/Downloads/project1",
    });
    expect(existingContextHref([s], "/home/dev/Downloads/project1")).toBe("/project/prj_demo");
  });

  it("falls back to the session when a directory match has no project route", () => {
    const s = session({
      id: "ses_b65a6b7e87b8CzQCqPAl397azv",
      opencodeDirectory: "/home/dev/scratch",
    });
    expect(existingContextHref([s], "/home/dev/scratch")).toBe(
      "/ses/ses_b65a6b7e87b8CzQCqPAl397azv",
    );
  });

  it("returns null when nothing matches", () => {
    const s = session({
      id: "ses_639753befdf6wDbqip9t5rYV7Z",
      opencodeProjectId: "prj_demo",
      opencodeDirectory: "/home/dev/Downloads/project1",
      opencodeWorktree: "/home/dev/Downloads/project1",
    });
    expect(existingContextHref([s], "/home/dev/work/nope")).toBeNull();
  });
});

describe("importSessionsHref", () => {
  it("encodes the workspace path in the URL", () => {
    const path = "/home/dev/Downloads/project1";
    expect(importSessionsHref(path)).toBe(`/sessions/${base64UrlEncode(path)}`);
    expect(base64UrlDecode(base64UrlEncode(path))).toBe(path);
  });

  it("preserves non-default provider in the query string", () => {
    const path = "/tmp/work";
    expect(importSessionsHref(path, { provider: "codex" })).toBe(
      `/sessions/${base64UrlEncode(path)}?provider=codex`,
    );
  });
});
