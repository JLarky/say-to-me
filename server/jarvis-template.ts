import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { root } from "./config.ts";
import { normalizeWorkspacePath } from "./workspace.ts";

export const jarvisTemplateDirectory = path.join(root, "templates", "jarvis");
export const jarvisBootstrapTemplatePath = path.join(
  jarvisTemplateDirectory,
  "bootstrap-message.md",
);

export function defaultJarvisParentPath(): string {
  return normalizeWorkspacePath("~/.say-to-me/jarvis")!;
}

export function resolveJarvisParentPath(preferred: string | null | undefined): string {
  const trimmed = preferred?.trim();
  if (!trimmed) return defaultJarvisParentPath();
  return normalizeWorkspacePath(trimmed) ?? defaultJarvisParentPath();
}

export function jarvisWorkspaceRoot(): string {
  return defaultJarvisParentPath();
}

export function jarvisWorkspaceName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "jarvis-session"
  );
}

export function validJarvisAlias(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) return null;
  return name;
}

/**
 * Resolve a stable workspace path under the preferred parent.
 * Rejects path traversal and paths that escape the parent.
 */
export function resolveJarvisWorkspacePath(
  aliasOrSlug: string,
  preferredParentPath?: string | null,
) {
  const parentDirectory = resolveJarvisParentPath(preferredParentPath);
  const slug = jarvisWorkspaceName(aliasOrSlug);
  if (!slug || slug.includes("..") || slug.includes("/") || slug.includes("\\")) {
    throw Object.assign(new Error("Invalid Jarvis workspace name."), { status: 400 });
  }
  const workspaceDirectory = path.resolve(parentDirectory, slug);
  const relative = path.relative(parentDirectory, workspaceDirectory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw Object.assign(new Error("Jarvis workspace path escapes the configured parent."), {
      status: 400,
    });
  }
  return { parentDirectory, slug, workspaceDirectory };
}

export function readJarvisBootstrapMessage(): string {
  return readFileSync(jarvisBootstrapTemplatePath, "utf8").trim();
}

export function materializeJarvisTemplate(
  workspaceDirectory: string,
  options: { crashDuringMaterialize?: () => void } = {},
): void {
  const sourceRoot = statSync(jarvisTemplateDirectory);
  if (!sourceRoot.isDirectory()) throw new Error("Jarvis template folder is not a directory.");

  copyTemplateDirectory(jarvisTemplateDirectory, workspaceDirectory, options);
}

export function isDirectoryEmptyOrMissing(directory: string): boolean {
  if (!existsSync(directory)) return true;
  const stats = statSync(directory);
  if (!stats.isDirectory()) return false;
  return readdirSync(directory).length === 0;
}

export function looksLikeJarvisGitWorkspace(directory: string): boolean {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return false;
  if (!existsSync(path.join(directory, ".git"))) return false;
  return existsSync(path.join(directory, "AGENTS.md"));
}

/** True when a directory exists but is not yet a Jarvis git workspace (owned staging only). */
export function isIncompleteJarvisStagingDirectory(directory: string): boolean {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return false;
  return !existsSync(path.join(directory, ".git"));
}

export type StageJarvisResult = {
  parentDirectory: string;
  slug: string;
  workspaceDirectory: string;
  /** True when an existing Jarvis git workspace was left untouched. */
  resumed: boolean;
  /** True only when this call created the directory (safe to compensate/rm). */
  createdDirectory: boolean;
};

export type StageJarvisWorkspaceOptions = {
  /**
   * When true, a nonempty non-git directory is treated as resumable because the
   * operation already persisted createdWorkspace ownership — never infer ownership
   * from file contents (e.g. a user's AGENTS.md).
   */
  resumeOwnedPartial?: boolean;
  /** Test hook: after mkdir, before materializeJarvisTemplate. */
  crashAfterMkdirBeforeMaterialize?: () => void;
  /** Test hook: during materialize, after at least one file is copied. */
  crashDuringMaterialize?: () => void;
  /** Test hook: after materializeJarvisTemplate returns. */
  crashAfterMaterialize?: () => void;
};

/**
 * Stage a Jarvis workspace at an explicit path (used on resume with persisted path).
 */
export function stageJarvisWorkspaceAt(
  workspaceDirectory: string,
  slug: string,
  options: StageJarvisWorkspaceOptions = {},
): StageJarvisResult {
  const parentDirectory = path.dirname(workspaceDirectory);
  mkdirSync(parentDirectory, { recursive: true, mode: 0o700 });

  if (looksLikeJarvisGitWorkspace(workspaceDirectory)) {
    return {
      parentDirectory,
      slug,
      workspaceDirectory,
      resumed: true,
      createdDirectory: false,
    };
  }
  // Only resume nonempty/partial dirs when the caller already owns them via DB flag.
  if (options.resumeOwnedPartial && isIncompleteJarvisStagingDirectory(workspaceDirectory)) {
    materializeJarvisTemplate(workspaceDirectory, {
      crashDuringMaterialize: options.crashDuringMaterialize,
    });
    options.crashAfterMaterialize?.();
    return {
      parentDirectory,
      slug,
      workspaceDirectory,
      resumed: false,
      createdDirectory: true,
    };
  }
  if (!isDirectoryEmptyOrMissing(workspaceDirectory)) {
    throw Object.assign(
      new Error(
        `Jarvis workspace already exists at ${workspaceDirectory} and is not an empty or resumable Jarvis repo.`,
      ),
      { status: 409 },
    );
  }

  // Record existence BEFORE mkdir/materialize so a pre-existing empty dir is never compensated.
  const directoryExisted = existsSync(workspaceDirectory);
  mkdirSync(workspaceDirectory, { recursive: true, mode: 0o700 });
  options.crashAfterMkdirBeforeMaterialize?.();
  materializeJarvisTemplate(workspaceDirectory, {
    crashDuringMaterialize: options.crashDuringMaterialize,
  });
  options.crashAfterMaterialize?.();
  return {
    parentDirectory,
    slug,
    workspaceDirectory,
    resumed: false,
    createdDirectory: !directoryExisted,
  };
}

/**
 * Stage a Jarvis workspace at a stable slug path (no auto -2 suffix).
 * - missing/empty → materialize template (createdDirectory=true)
 * - existing valid Jarvis git repo → leave in place (resumed, createdDirectory=false)
 * - nonempty other content → 409
 */
export function stageJarvisWorkspace(
  alias: string,
  preferredParentPath?: string | null,
): StageJarvisResult {
  const resolved = resolveJarvisWorkspacePath(alias, preferredParentPath);
  return stageJarvisWorkspaceAt(resolved.workspaceDirectory, resolved.slug);
}

/** @deprecated Prefer stageJarvisWorkspace for stable slug paths. */
export function createJarvisWorkspaceScaffold(
  name: string,
  preferredParentPath?: string | null,
): string {
  return stageJarvisWorkspace(name, preferredParentPath).workspaceDirectory;
}

/** Only remove directories this operation created — never a resumed user repo. */
export function removeJarvisWorkspaceDirectory(workspaceDirectory: string): void {
  if (existsSync(workspaceDirectory)) {
    rmSync(workspaceDirectory, { recursive: true, force: true });
  }
}

export function recordJarvisSessionArtifact({
  name,
  sessionId,
  workspaceDirectory,
}: {
  name: string;
  sessionId: string;
  workspaceDirectory: string;
}): void {
  appendFileSync(
    path.join(workspaceDirectory, "sessions.md"),
    [
      "",
      `## ${new Date().toISOString()}`,
      "",
      `- Jarvis name: ${name}`,
      `- Say To Me session ID: ${sessionId}`,
      `- OpenCode session ID: ${sessionId}`,
      `- Workspace: ${workspaceDirectory}`,
      "",
    ].join("\n"),
  );
}

function copyTemplateDirectory(
  sourceDirectory: string,
  targetDirectory: string,
  options: { crashDuringMaterialize?: () => void; _copiedOnce?: { value: boolean } } = {},
): void {
  mkdirSync(targetDirectory, { recursive: true });
  const copiedOnce = options._copiedOnce ?? { value: false };

  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      copyTemplateDirectory(sourcePath, targetPath, { ...options, _copiedOnce: copiedOnce });
      continue;
    }
    if (!entry.isFile() || existsSync(targetPath)) continue;
    copyFileSync(sourcePath, targetPath);
    if (!copiedOnce.value) {
      copiedOnce.value = true;
      options.crashDuringMaterialize?.();
    }
  }
}
