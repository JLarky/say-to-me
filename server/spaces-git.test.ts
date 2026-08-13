import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  createGitWorktree,
  parseLsRemoteSymrefHead,
  parseRemoteTrackingBase,
  resolveDefaultRemoteBase,
} from "./spaces-git.ts";

const execFileAsync = promisify(execFile);

async function gitC(directory: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", directory, ...args], {
    encoding: "utf8",
  });
  return result.stdout.trim();
}

describe("parseRemoteTrackingBase", () => {
  it("parses origin/main when origin is a remote", () => {
    expect(parseRemoteTrackingBase("origin/main", ["origin"])).toEqual({
      remote: "origin",
      ref: "main",
    });
  });

  it("parses nested remote branch names", () => {
    expect(parseRemoteTrackingBase("origin/feature/foo", ["origin"])).toEqual({
      remote: "origin",
      ref: "feature/foo",
    });
  });

  it("ignores local branches that only look like remote/ref", () => {
    expect(parseRemoteTrackingBase("feature/foo", ["origin"])).toBeNull();
    expect(parseRemoteTrackingBase("main", ["origin"])).toBeNull();
  });
});

describe("parseLsRemoteSymrefHead", () => {
  it("parses the symref line from ls-remote --symref HEAD", () => {
    expect(parseLsRemoteSymrefHead("ref: refs/heads/develop\tHEAD\nabc123\tHEAD\n", "origin")).toBe(
      "origin/develop",
    );
  });

  it("returns null when HEAD is not a branch symref", () => {
    expect(parseLsRemoteSymrefHead("abc123\tHEAD\n", "origin")).toBeNull();
  });
});

describe("resolveDefaultRemoteBase", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("resolves origin/HEAD when the remote default is develop", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "say-to-me-default-develop-"));
    dirs.push(root);
    const bare = path.join(root, "bare.git");
    const clone = path.join(root, "clone");

    await execFileAsync("git", ["init", "--bare", "-q", bare]);
    await execFileAsync("git", ["clone", "-q", bare, clone]);
    await gitC(clone, ["config", "user.email", "test@example.com"]);
    await gitC(clone, ["config", "user.name", "Default Test"]);
    writeFileSync(path.join(clone, "seed.txt"), "v1\n");
    await gitC(clone, ["add", "seed.txt"]);
    await gitC(clone, ["commit", "-q", "-m", "v1"]);
    await gitC(clone, ["branch", "-M", "develop"]);
    await gitC(clone, ["push", "-q", "-u", "origin", "develop"]);
    await gitC(clone, ["remote", "set-head", "origin", "develop"]);

    expect(await resolveDefaultRemoteBase(clone)).toBe("origin/develop");
  });

  it("uses live remote HEAD when local origin/HEAD is stale", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "say-to-me-stale-head-"));
    dirs.push(root);
    const bare = path.join(root, "bare.git");
    const clone = path.join(root, "clone");

    await execFileAsync("git", ["init", "--bare", "-q", bare]);
    await execFileAsync("git", ["clone", "-q", bare, clone]);
    await gitC(clone, ["config", "user.email", "test@example.com"]);
    await gitC(clone, ["config", "user.name", "Stale Head"]);
    writeFileSync(path.join(clone, "seed.txt"), "develop\n");
    await gitC(clone, ["add", "seed.txt"]);
    await gitC(clone, ["commit", "-q", "-m", "develop"]);
    await gitC(clone, ["branch", "-M", "develop"]);
    await gitC(clone, ["push", "-q", "-u", "origin", "develop"]);
    await gitC(clone, ["remote", "set-head", "origin", "develop"]);

    // Change the bare remote default to main without refreshing the clone's origin/HEAD.
    await gitC(bare, ["branch", "main", "develop"]);
    await gitC(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    expect(await gitC(clone, ["symbolic-ref", "refs/remotes/origin/HEAD"])).toBe(
      "refs/remotes/origin/develop",
    );

    expect(await resolveDefaultRemoteBase(clone)).toBe("origin/main");
  });

  it("falls back to local remote-tracking refs when ls-remote is unavailable", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "say-to-me-default-fallback-"));
    dirs.push(root);
    const bare = path.join(root, "bare.git");
    const clone = path.join(root, "clone");

    await execFileAsync("git", ["init", "--bare", "-q", bare]);
    await execFileAsync("git", ["clone", "-q", bare, clone]);
    await gitC(clone, ["config", "user.email", "test@example.com"]);
    await gitC(clone, ["config", "user.name", "Default Test"]);
    writeFileSync(path.join(clone, "seed.txt"), "v1\n");
    await gitC(clone, ["add", "seed.txt"]);
    await gitC(clone, ["commit", "-q", "-m", "v1"]);
    await gitC(clone, ["branch", "-M", "develop"]);
    await gitC(clone, ["push", "-q", "-u", "origin", "develop"]);
    await gitC(clone, ["remote", "set-head", "origin", "--delete"]).catch(() => undefined);
    // Break live remote discovery so the local common-branch fallback is exercised.
    await gitC(clone, ["remote", "set-url", "origin", path.join(root, "missing.git")]);

    expect(await resolveDefaultRemoteBase(clone)).toBe("origin/develop");
  });
});

describe("createGitWorktree remote fetch", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("fetches origin/main before creating so the worktree uses the latest remote tip", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "say-to-me-fetch-wt-"));
    dirs.push(root);
    const bare = path.join(root, "bare.git");
    const clone = path.join(root, "clone");
    const worktree = path.join(root, "agent-wt");

    await execFileAsync("git", ["init", "--bare", "-q", bare]);
    await execFileAsync("git", ["clone", "-q", bare, clone]);
    await gitC(clone, ["config", "user.email", "test@example.com"]);
    await gitC(clone, ["config", "user.name", "Fetch Test"]);
    writeFileSync(path.join(clone, "seed.txt"), "v1\n");
    await gitC(clone, ["add", "seed.txt"]);
    await gitC(clone, ["commit", "-q", "-m", "v1"]);
    await gitC(clone, ["branch", "-M", "main"]);
    await gitC(clone, ["push", "-q", "-u", "origin", "main"]);

    const staleTip = await gitC(clone, ["rev-parse", "origin/main"]);

    // Advance origin/main without updating the clone's remote-tracking ref.
    const pusher = path.join(root, "pusher");
    await execFileAsync("git", ["clone", "-q", "-b", "main", bare, pusher]);
    await gitC(pusher, ["config", "user.email", "test@example.com"]);
    await gitC(pusher, ["config", "user.name", "Fetch Test"]);
    writeFileSync(path.join(pusher, "seed.txt"), "v2\n");
    await gitC(pusher, ["add", "seed.txt"]);
    await gitC(pusher, ["commit", "-q", "-m", "v2"]);
    await gitC(pusher, ["push", "-q", "origin", "main"]);
    const freshTip = await gitC(pusher, ["rev-parse", "HEAD"]);
    expect(freshTip).not.toBe(staleTip);
    expect(await gitC(clone, ["rev-parse", "origin/main"])).toBe(staleTip);

    await createGitWorktree(clone, "agent/cursor-test", worktree, "origin/main");

    expect(await gitC(clone, ["rev-parse", "origin/main"])).toBe(freshTip);
    expect(await gitC(worktree, ["rev-parse", "HEAD"])).toBe(freshTip);
    expect(await gitC(worktree, ["branch", "--show-current"])).toBe("agent/cursor-test");
  });

  it("resolves origin/HEAD to develop before creating the worktree", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "say-to-me-head-wt-"));
    dirs.push(root);
    const bare = path.join(root, "bare.git");
    const clone = path.join(root, "clone");
    const worktree = path.join(root, "agent-wt");

    await execFileAsync("git", ["init", "--bare", "-q", bare]);
    await execFileAsync("git", ["clone", "-q", bare, clone]);
    await gitC(clone, ["config", "user.email", "test@example.com"]);
    await gitC(clone, ["config", "user.name", "Head Test"]);
    writeFileSync(path.join(clone, "seed.txt"), "develop\n");
    await gitC(clone, ["add", "seed.txt"]);
    await gitC(clone, ["commit", "-q", "-m", "develop"]);
    await gitC(clone, ["branch", "-M", "develop"]);
    await gitC(clone, ["push", "-q", "-u", "origin", "develop"]);
    await gitC(clone, ["remote", "set-head", "origin", "develop"]);

    const tip = await gitC(clone, ["rev-parse", "origin/develop"]);
    await createGitWorktree(clone, "agent/cursor-develop", worktree, "origin/HEAD");

    expect(await gitC(worktree, ["rev-parse", "HEAD"])).toBe(tip);
    expect(await gitC(worktree, ["branch", "--show-current"])).toBe("agent/cursor-develop");
  });

  it("creates from the live remote default when local origin/HEAD is stale", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "say-to-me-stale-wt-"));
    dirs.push(root);
    const bare = path.join(root, "bare.git");
    const clone = path.join(root, "clone");
    const worktree = path.join(root, "agent-wt");

    await execFileAsync("git", ["init", "--bare", "-q", bare]);
    await execFileAsync("git", ["clone", "-q", bare, clone]);
    await gitC(clone, ["config", "user.email", "test@example.com"]);
    await gitC(clone, ["config", "user.name", "Stale Wt"]);
    writeFileSync(path.join(clone, "seed.txt"), "develop\n");
    await gitC(clone, ["add", "seed.txt"]);
    await gitC(clone, ["commit", "-q", "-m", "develop"]);
    await gitC(clone, ["branch", "-M", "develop"]);
    await gitC(clone, ["push", "-q", "-u", "origin", "develop"]);
    await gitC(clone, ["remote", "set-head", "origin", "develop"]);

    // Switch bare default to a new main tip without refreshing clone origin/HEAD.
    const pusher = path.join(root, "pusher");
    await execFileAsync("git", ["clone", "-q", bare, pusher]);
    await gitC(pusher, ["config", "user.email", "test@example.com"]);
    await gitC(pusher, ["config", "user.name", "Stale Wt"]);
    await gitC(pusher, ["checkout", "-q", "-b", "main"]);
    writeFileSync(path.join(pusher, "seed.txt"), "main\n");
    await gitC(pusher, ["add", "seed.txt"]);
    await gitC(pusher, ["commit", "-q", "-m", "main"]);
    await gitC(pusher, ["push", "-q", "-u", "origin", "main"]);
    await gitC(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    const mainTip = await gitC(pusher, ["rev-parse", "HEAD"]);
    expect(await gitC(clone, ["symbolic-ref", "refs/remotes/origin/HEAD"])).toBe(
      "refs/remotes/origin/develop",
    );

    await createGitWorktree(clone, "agent/cursor-stale", worktree, "origin/HEAD");

    expect(await gitC(worktree, ["rev-parse", "HEAD"])).toBe(mainTip);
    expect(await gitC(worktree, ["branch", "--show-current"])).toBe("agent/cursor-stale");
  });

  it("does not fetch when the base is a local branch", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "say-to-me-local-wt-"));
    dirs.push(root);
    const repo = path.join(root, "repo");
    const worktree = path.join(root, "wt");

    await execFileAsync("git", ["init", "-q", "-b", "main", repo]);
    await gitC(repo, ["config", "user.email", "test@example.com"]);
    await gitC(repo, ["config", "user.name", "Local Test"]);
    await gitC(repo, ["commit", "--allow-empty", "-q", "-m", "seed"]);
    // Fake remote that would fail if we tried to fetch.
    await gitC(repo, ["remote", "add", "origin", path.join(root, "missing.git")]);

    await createGitWorktree(repo, "agent/local-test", worktree, "main");
    expect(await gitC(worktree, ["branch", "--show-current"])).toBe("agent/local-test");
  });
});
