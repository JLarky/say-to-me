import { execFile } from "node:child_process";
import { realpath, stat, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitCheckout = { path: string; branch: string; isMain: boolean };
export type GitRepository = {
  requestedPath: string;
  rootPath: string;
  identity: string;
  name: string;
  checkouts: GitCheckout[];
};

function expandPath(value: string): string {
  const expanded = value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
  return path.resolve(expanded);
}

async function git(directory: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

export async function discoverRepository(
  input: string,
  options: { includeWorktrees?: boolean } = {},
): Promise<GitRepository> {
  const requested = expandPath(input);
  const requestedStat = await stat(requested).catch(() => null);
  if (!requestedStat) throw new Error("Repository path does not exist.");
  const requestedPath = await realpath(requested);
  const checkoutPath = await realpath(await git(requested, ["rev-parse", "--show-toplevel"]));
  const commonGitDirValue = await git(requested, ["rev-parse", "--git-common-dir"]);
  const commonGitDir = await realpath(
    path.isAbsolute(commonGitDirValue)
      ? commonGitDirValue
      : path.resolve(requestedPath, commonGitDirValue),
  );
  const rootPath =
    path.basename(commonGitDir) === ".git" ? path.dirname(commonGitDir) : checkoutPath;
  const identity =
    (await git(rootPath, ["config", "--get", "remote.origin.url"]).catch(() => "")) || rootPath;
  const name = path.basename(rootPath);
  if (options.includeWorktrees === false) {
    return {
      requestedPath,
      rootPath,
      identity,
      name,
      checkouts: [
        {
          path: rootPath,
          branch: (await git(rootPath, ["branch", "--show-current"])) || "(detached)",
          isMain: true,
        },
      ],
    };
  }
  const checkouts: GitCheckout[] = [];
  const porcelain = await git(rootPath, ["worktree", "list", "--porcelain"]);
  type WorktreeRecord = { path?: string; branch?: string };
  let current: WorktreeRecord = {};
  const flush = async () => {
    if (!current.path) return;
    const checkoutPath = await realpath(current.path).catch(() => null);
    if (!checkoutPath) {
      current = {};
      return;
    }
    checkouts.push({
      path: checkoutPath,
      branch: current.branch || "(detached)",
      isMain: checkoutPath === rootPath,
    });
    current = {};
  };
  for (const line of porcelain.split("\n")) {
    if (!line) {
      await flush();
    } else if (line.startsWith("worktree ")) {
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (line === "detached") {
      current.branch = "(detached)";
    }
  }
  await flush();
  if (!checkouts.some((checkout) => checkout.isMain)) {
    checkouts.unshift({
      path: rootPath,
      branch: (await git(rootPath, ["branch", "--show-current"])) || "(detached)",
      isMain: true,
    });
  }
  return { requestedPath, rootPath, identity, name, checkouts };
}

/**
 * Split `origin/main` (or `origin/feature/foo`) into remote + ref when the
 * first path segment is a configured remote. Local branches like `main` or
 * `feature/foo` (when `feature` is not a remote) return null.
 */
export function parseRemoteTrackingBase(
  base: string,
  remotes: readonly string[],
): { remote: string; ref: string } | null {
  const trimmed = base.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  const remote = trimmed.slice(0, slash);
  const ref = trimmed.slice(slash + 1);
  if (!remotes.includes(remote)) return null;
  return { remote, ref };
}

const COMMON_DEFAULT_BRANCHES = ["main", "master", "develop"] as const;

/**
 * Parse `git ls-remote --symref <remote> HEAD` output into `origin/main`-style
 * refs. Example first line: `ref: refs/heads/develop\tHEAD`.
 */
export function parseLsRemoteSymrefHead(output: string, remote: string): string | null {
  for (const line of output.split("\n")) {
    const match = /^ref:\s+refs\/heads\/(.+?)\tHEAD\s*$/.exec(line);
    if (!match?.[1]) continue;
    const branch = match[1].trim();
    if (branch && branch !== "HEAD") return `${remote}/${branch}`;
  }
  return null;
}

/**
 * Resolve `origin/HEAD` (or another remote's HEAD) to a concrete remote-tracking
 * ref such as `origin/main` or `origin/develop`.
 *
 * Prefers a live `git ls-remote --symref` against the remote so a stale local
 * `refs/remotes/origin/HEAD` cannot pin agent worktrees to an old default.
 * Falls back to the local symbolic ref, then common default branch names.
 */
export async function resolveDefaultRemoteBase(
  repositoryPath: string,
  remote = "origin",
): Promise<string | null> {
  const remotes = (await git(repositoryPath, ["remote"]))
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
  if (!remotes.includes(remote)) return null;

  const lsRemote = await git(repositoryPath, ["ls-remote", "--symref", remote, "HEAD"]).catch(
    () => "",
  );
  const fromRemote = parseLsRemoteSymrefHead(lsRemote, remote);
  if (fromRemote) return fromRemote;

  const headRef = await git(repositoryPath, [
    "symbolic-ref",
    "--quiet",
    `refs/remotes/${remote}/HEAD`,
  ]).catch(() => "");
  const prefix = `refs/remotes/${remote}/`;
  if (headRef.startsWith(prefix)) {
    const branch = headRef.slice(prefix.length);
    if (branch && branch !== "HEAD") return `${remote}/${branch}`;
  }

  for (const name of COMMON_DEFAULT_BRANCHES) {
    const exists = await git(repositoryPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/${remote}/${name}`,
    ])
      .then(() => true)
      .catch(() => false);
    if (exists) return `${remote}/${name}`;
  }
  return null;
}

export async function createGitWorktree(
  repositoryPath: string,
  branch: string,
  destination: string,
  base: string,
): Promise<string> {
  await mkdir(path.dirname(destination), { recursive: true });
  const remotes = (await git(repositoryPath, ["remote"]))
    .split("\n")
    .map((name) => name.trim())
    .filter(Boolean);
  let effectiveBase = base.trim();
  const requestedRemote = parseRemoteTrackingBase(effectiveBase, remotes);
  if (requestedRemote?.ref === "HEAD") {
    const resolved = await resolveDefaultRemoteBase(repositoryPath, requestedRemote.remote);
    if (!resolved) {
      throw new Error(
        `Could not resolve ${requestedRemote.remote}/HEAD to a default branch (tried main, master, develop).`,
      );
    }
    effectiveBase = resolved;
  }
  const remoteBase = parseRemoteTrackingBase(effectiveBase, remotes);
  if (remoteBase) {
    // Update the remote-tracking tip before worktree add so origin/main (etc.)
    // is not a stale local cache of the remote branch.
    await git(repositoryPath, [
      "fetch",
      remoteBase.remote,
      `+refs/heads/${remoteBase.ref}:refs/remotes/${remoteBase.remote}/${remoteBase.ref}`,
    ]);
  }
  await git(repositoryPath, ["worktree", "add", "-b", branch, destination, effectiveBase]);
  return realpath(destination);
}
