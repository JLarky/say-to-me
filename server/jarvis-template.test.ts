import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  createJarvisWorkspaceScaffold,
  defaultJarvisParentPath,
  resolveJarvisParentPath,
} from "./jarvis-template.ts";

describe("jarvis workspace parent resolution", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const directory of created.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("defaults to ~/.say-to-me/jarvis", () => {
    expect(defaultJarvisParentPath()).toBe(path.join(homedir(), ".say-to-me", "jarvis"));
    expect(resolveJarvisParentPath(null)).toBe(defaultJarvisParentPath());
    expect(resolveJarvisParentPath("  ")).toBe(defaultJarvisParentPath());
  });

  it("expands a custom preferred parent", () => {
    expect(resolveJarvisParentPath("~/Code/jarvises")).toBe(
      path.join(homedir(), "Code", "jarvises"),
    );
  });

  it("creates the-jarvis under the resolved parent", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "say-to-me-jarvis-parent-"));
    created.push(parent);
    const workspace = createJarvisWorkspaceScaffold("the jarvis", parent);
    expect(workspace).toBe(path.join(parent, "the-jarvis"));
    expect(existsSync(path.join(workspace, "AGENTS.md"))).toBe(true);
  });

  it("rejects a nonempty non-jarvis directory at the stable slug", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "say-to-me-jarvis-parent-"));
    created.push(parent);
    const collision = path.join(parent, "the-jarvis");
    mkdirSync(collision);
    writeFileSync(path.join(collision, "noise.txt"), "nope");
    expect(() => createJarvisWorkspaceScaffold("the jarvis", parent)).toThrow(/already exists/);
  });
});
