import { describe, expect, it, vi } from "vite-plus/test";
import type { PrototypeRepo } from "./new-space-prototype.ts";
import {
  findCreatedWorktreePath,
  resolveAgentBase,
  suggestAgentBranch,
  worktreeFolderNameFromBranch,
} from "./agent-worktree-session.ts";

describe("suggestAgentBranch", () => {
  it("names branches agent/<provider>-<id>", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "abcd1234-5678-90ab-cdef-111111111111",
    );
    expect(suggestAgentBranch("cursor")).toBe("agent/cursor-abcd1234");
    expect(suggestAgentBranch("claude")).toBe("agent/claude-abcd1234");
  });

  it("retargets the provider while keeping a stable id", () => {
    expect(suggestAgentBranch("cursor", "a2c8107d")).toBe("agent/cursor-a2c8107d");
    expect(suggestAgentBranch("claude", "a2c8107d")).toBe("agent/claude-a2c8107d");
  });

  it("falls back when randomUUID is missing", () => {
    const cryptoObj = globalThis.crypto;
    const originalDescriptor = Object.getOwnPropertyDescriptor(cryptoObj, "randomUUID");
    // Simulate environments where crypto exists but randomUUID does not.
    Object.defineProperty(cryptoObj, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(cryptoObj, "getRandomValues").mockImplementation((buffer) => {
      // SAFETY: this mock only stands in for the branch-suggestion code path, which
      // always calls crypto.getRandomValues with a Uint8Array view.
      const bytes = buffer as Uint8Array;
      bytes.set([0xab, 0xcd, 0x12, 0x34]);
      return buffer;
    });
    try {
      expect(suggestAgentBranch("grok")).toBe("agent/grok-abcd1234");
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(cryptoObj, "randomUUID", originalDescriptor);
      } else {
        Reflect.deleteProperty(cryptoObj, "randomUUID");
      }
    }
  });
});

describe("resolveAgentBase", () => {
  it("uses origin/HEAD when the remote-default checkbox is on", () => {
    expect(resolveAgentBase("feature/foo", true)).toBe("origin/HEAD");
  });

  it("keeps the selected checkout base when the checkbox is off", () => {
    expect(resolveAgentBase("feature/foo", false)).toBe("feature/foo");
  });
});

describe("worktreeFolderNameFromBranch", () => {
  it("uses the last path segment", () => {
    expect(worktreeFolderNameFromBranch("agent/cursor-abcd1234")).toBe("cursor-abcd1234");
    expect(worktreeFolderNameFromBranch("plain")).toBe("plain");
  });
});

describe("findCreatedWorktreePath", () => {
  const repo: PrototypeRepo = {
    id: "repo-1",
    name: "say-to-me",
    path: "/home/dev/say-to-me",
    worktrees: ["cursor-abcd1234"],
    worktreeBranches: { "cursor-abcd1234": "agent/cursor-abcd1234" },
    worktreePaths: {
      "cursor-abcd1234": "/home/dev/workspaces/say-to-me-agent-cursor-abcd1234",
    },
  };

  it("resolves by branch mapping", () => {
    expect(findCreatedWorktreePath(repo, "agent/cursor-abcd1234")).toBe(
      "/home/dev/workspaces/say-to-me-agent-cursor-abcd1234",
    );
  });

  it("returns null when missing", () => {
    expect(findCreatedWorktreePath(repo, "agent/missing")).toBeNull();
  });
});
