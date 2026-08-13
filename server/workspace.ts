import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export function normalizeWorkspacePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.includes("\0")) return null;
  const expanded = trimmed === "~" ? homedir() : trimmed.replace(/^~(?=\/)/, homedir());
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  // Relative paths resolve from $HOME, e.g. "Downloads/project1" -> "$HOME/Downloads/project1".
  return path.resolve(homedir(), expanded);
}

export function canWriteDirectory(directory: string): boolean {
  try {
    accessSync(directory, constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function nearestExistingParent(workspacePath: string): string | null {
  let current = path.dirname(workspacePath);
  while (current && current !== path.dirname(current)) {
    if (existsSync(current)) return current;
    current = path.dirname(current);
  }
  return existsSync(current) ? current : null;
}

export function suggestedTempWorkspacePath(): string {
  return path.join(tmpdir(), `say-to-me-${randomUUID().slice(0, 6)}`);
}

export function workspacePathStatus(input: unknown):
  | {
      ok: true;
      path: string;
      exists: boolean;
      isDirectory: boolean;
      writable: boolean;
      creatable: boolean;
      parentPath: string | null;
    }
  | { ok: false; error: string } {
  const workspacePath = normalizeWorkspacePath(input);
  if (!workspacePath) return { ok: false, error: "Enter a folder path." };
  if (!existsSync(workspacePath)) {
    const parentPath = nearestExistingParent(workspacePath);
    const creatable = parentPath ? canWriteDirectory(parentPath) : false;
    return {
      ok: true,
      path: workspacePath,
      exists: false,
      isDirectory: false,
      writable: false,
      creatable,
      parentPath,
    };
  }
  const isDirectory = statSync(workspacePath).isDirectory();
  const writable = isDirectory && canWriteDirectory(workspacePath);
  return {
    ok: true,
    path: workspacePath,
    exists: true,
    isDirectory,
    writable,
    creatable: false,
    parentPath: null,
  };
}
