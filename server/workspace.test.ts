import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { normalizeWorkspacePath } from "./workspace.ts";

describe("normalizeWorkspacePath", () => {
  it("keeps absolute paths", () => {
    expect(normalizeWorkspacePath("/tmp/say-to-me/work")).toBe("/tmp/say-to-me/work");
  });

  it("resolves relative paths from $HOME", () => {
    expect(normalizeWorkspacePath("Downloads/project1")).toBe(
      path.join(homedir(), "Downloads", "project1"),
    );
  });

  it("resolves ./ and ../ segments from $HOME", () => {
    expect(normalizeWorkspacePath("./Downloads/./project1")).toBe(
      path.join(homedir(), "Downloads", "project1"),
    );
    expect(normalizeWorkspacePath("../shared")).toBe(path.resolve(homedir(), "../shared"));
  });

  it("expands ~ and ~/ to the home directory", () => {
    expect(normalizeWorkspacePath("~")).toBe(homedir());
    expect(normalizeWorkspacePath("~/work")).toBe(path.join(homedir(), "work"));
  });

  it("rejects empty, non-string, and NUL-bearing input", () => {
    expect(normalizeWorkspacePath("")).toBeNull();
    expect(normalizeWorkspacePath("   ")).toBeNull();
    expect(normalizeWorkspacePath(42)).toBeNull();
    expect(normalizeWorkspacePath(null)).toBeNull();
    expect(normalizeWorkspacePath("work/\0bad")).toBeNull();
  });
});
