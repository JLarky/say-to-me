import { realpathSync } from "node:fs";

/** Resolve symlinks (e.g. lima /home ↔ /Users) before deriving on-disk agent paths. */
export function canonicalCwd(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}
