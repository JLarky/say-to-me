import os from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { discoverRepository, type GitCheckout, type GitRepository } from "./spaces-git.ts";

export function expandPath(value: string): string {
  const expanded = value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
  return path.resolve(expanded);
}

export function realpathSyncSafe(value: string): string | null {
  try {
    return realpathSync(expandPath(value));
  } catch {
    return null;
  }
}

/** Longest worktree path that equals cwd or is a parent directory of cwd. */
export function matchCheckoutPath(
  canonicalCwd: string,
  checkoutPaths: readonly string[],
): string | null {
  let best: string | null = null;
  for (const candidate of checkoutPaths) {
    if (
      canonicalCwd === candidate ||
      canonicalCwd.startsWith(candidate.endsWith(path.sep) ? candidate : candidate + path.sep)
    ) {
      if (!best || candidate.length > best.length) best = candidate;
    }
  }
  return best;
}

export function matchCheckout(
  canonicalCwd: string,
  checkouts: readonly GitCheckout[],
): GitCheckout | null {
  const matchedPath = matchCheckoutPath(
    canonicalCwd,
    checkouts.map((checkout) => checkout.path),
  );
  return checkouts.find((checkout) => checkout.path === matchedPath) ?? null;
}

export type SessionCheckoutLookup =
  | { kind: "no-cwd" }
  | { kind: "cwd-deleted"; cwd: string }
  | { kind: "non-git"; cwd: string; canonicalCwd: string }
  | {
      kind: "resolved";
      cwd: string;
      canonicalCwd: string;
      checkout: GitCheckout;
      discovered: GitRepository;
    };

export async function lookupSessionCheckout(input: {
  cwd: string | null | undefined;
}): Promise<SessionCheckoutLookup> {
  const cwd = input.cwd?.trim() || "";
  if (!cwd) return { kind: "no-cwd" };
  const canonicalCwd = await realpath(expandPath(cwd)).catch(() => null);
  if (!canonicalCwd) return { kind: "cwd-deleted", cwd };
  const discovered = await discoverRepository(canonicalCwd).catch(() => null);
  if (!discovered) return { kind: "non-git", cwd, canonicalCwd };
  const checkout = matchCheckout(canonicalCwd, discovered.checkouts);
  if (!checkout) return { kind: "non-git", cwd, canonicalCwd };
  return { kind: "resolved", cwd, canonicalCwd, checkout, discovered };
}
