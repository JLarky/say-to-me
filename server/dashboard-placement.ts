import { eq } from "drizzle-orm";
import { drizzleDb } from "./db/index.ts";
import {
  repositories,
  sessions,
  spaceRepositories,
  spaceSessions,
  spaceWorktrees,
  spaces,
  worktrees,
} from "./db/drizzle-schema.ts";
import { resolveListDisplayName } from "../src/session-display.ts";
import { lookupSessionCheckout, matchCheckoutPath, realpathSyncSafe } from "./session-checkout.ts";

export type DashboardPlacementBlockReason =
  | "no-spaces"
  | "cwd-deleted"
  | "non-git"
  | "owner-archived"
  | "context-unresolved"
  | "main-clone-ambiguous";

export type DashboardRepairState =
  | "owner-missing"
  | "owner-archived"
  | "repo-detached"
  | "worktree-detached"
  | "context-unresolved"
  | "main-clone-ambiguous";

export type DiscoveredCheckoutDescriptor = {
  checkoutPath: string;
  branch: string;
  isMain: boolean;
  repositoryIdentity: string;
  repositoryRootPath: string;
  repositoryName: string;
};

export type DashboardPlacement = {
  sessionId: string;
  title: string;
  cwd: string | null;
  ownerSpaceId: string | null;
  ownerSpaceName: string | null;
  ownerArchived: boolean;
  repositoryId: string | null;
  worktreeId: string | null;
  isMainCheckout: boolean | null;
  placementPossible: boolean;
  placementBlockReason: DashboardPlacementBlockReason | null;
  repairState: DashboardRepairState | null;
  canonicalDashboardPath: string | null;
  needsChooser: boolean;
  chooserMode: "claim" | "move" | null;
  discovered: DiscoveredCheckoutDescriptor | null;
  preview: {
    targetSpaceId: string | null;
    wouldAttachRepository: boolean;
    wouldAttachWorktree: boolean;
    warnings: string[];
  };
};

function sessionTitle(session: typeof sessions.$inferSelect): string {
  return resolveListDisplayName({
    id: session.id,
    alias: session.alias,
    opencodeTitle: session.opencodeProjectName,
    cwd: session.cwd,
  });
}

function buildDashboardPath(
  spaceId: string,
  repositoryId: string | null,
  worktreeId: string | null,
): string {
  const params = new URLSearchParams();
  if (repositoryId) params.set("repo", repositoryId);
  if (worktreeId) params.set("worktreeId", worktreeId);
  const suffix = params.size ? `?${params.toString()}` : "";
  return `/dashboard/${encodeURIComponent(spaceId)}${suffix}`;
}

function findWorktreeByPath(checkoutPath: string) {
  return drizzleDb.select().from(worktrees).where(eq(worktrees.path, checkoutPath)).get();
}

function findRepositoryByIdentity(identity: string) {
  return drizzleDb.select().from(repositories).where(eq(repositories.identity, identity)).get();
}

function spaceHasRepository(spaceId: string, repositoryId: string): boolean {
  return Boolean(
    drizzleDb
      .select()
      .from(spaceRepositories)
      .where(eq(spaceRepositories.spaceId, spaceId))
      .all()
      .find((row) => row.repositoryId === repositoryId),
  );
}

function spaceHasWorktree(spaceId: string, worktreeId: string): boolean {
  return Boolean(
    drizzleDb
      .select()
      .from(spaceWorktrees)
      .where(eq(spaceWorktrees.spaceId, spaceId))
      .all()
      .find((row) => row.worktreeId === worktreeId),
  );
}

function activeSpaceCount(): number {
  return drizzleDb
    .select()
    .from(spaces)
    .all()
    .filter((space) => !space.archived).length;
}

/**
 * Non-mutating placement resolver. Never syncs repositories/worktrees rows.
 * When the exact checkout has no worktrees row, returns discovered descriptors only.
 */
export async function resolveDashboardPlacement(
  sessionId: string,
  targetSpaceId?: string | null,
): Promise<DashboardPlacement> {
  const session = drizzleDb.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) {
    throw Object.assign(new Error("Session not found."), { status: 404 });
  }

  const ownerRow = drizzleDb
    .select()
    .from(spaceSessions)
    .where(eq(spaceSessions.sessionId, sessionId))
    .get();
  let ownerSpace =
    ownerRow && drizzleDb.select().from(spaces).where(eq(spaces.id, ownerRow.spaceId)).get();
  let ownerMissing = Boolean(ownerRow && !ownerSpace);
  if (ownerMissing) ownerSpace = undefined;

  const ownerSpaceId = ownerSpace?.id ?? null;
  const ownerArchived = Boolean(ownerSpace?.archived);
  const hasActiveSpaces = activeSpaceCount() > 0;
  const previewTarget = targetSpaceId?.trim() || null;

  // Happy path for Links → Dashboard: owned, active space. Resolve worktree from
  // synced DB rows only — skip discoverRepository (often 40–70ms+ of git/fs work).
  // Chooser / preview / unowned paths still need the full checkout lookup below.
  if (ownerSpaceId && !ownerArchived && !ownerMissing && !previewTarget) {
    if (!hasActiveSpaces) {
      return {
        sessionId,
        title: sessionTitle(session),
        cwd: session.cwd,
        ownerSpaceId,
        ownerSpaceName: ownerSpace?.name ?? null,
        ownerArchived,
        repositoryId: null,
        worktreeId: null,
        isMainCheckout: null,
        placementPossible: false,
        placementBlockReason: "no-spaces",
        repairState: null,
        canonicalDashboardPath: null,
        needsChooser: false,
        chooserMode: null,
        discovered: null,
        preview: {
          targetSpaceId: null,
          wouldAttachRepository: false,
          wouldAttachWorktree: false,
          warnings: [],
        },
      };
    }
    const existing = resolveExistingWorktreeForCwd(session.cwd);
    const repositoryId = existing?.repositoryId ?? null;
    const worktreeId = existing?.worktreeId ?? null;
    const isMainCheckout = existing ? existing.isMain : null;
    let repairState: DashboardRepairState | null = null;
    if (repositoryId && !spaceHasRepository(ownerSpaceId, repositoryId)) {
      repairState = "repo-detached";
    } else if (
      worktreeId &&
      isMainCheckout === false &&
      !spaceHasWorktree(ownerSpaceId, worktreeId)
    ) {
      repairState = "worktree-detached";
    } else if (!worktreeId && session.cwd?.trim()) {
      // cwd present but no synced worktree — still land on the space overview.
      repairState = "context-unresolved";
    }
    const canonicalDashboardPath =
      repairState === "repo-detached" ||
      repairState === "worktree-detached" ||
      repairState === "context-unresolved"
        ? buildDashboardPath(ownerSpaceId, repositoryId, null)
        : repositoryId && worktreeId
          ? buildDashboardPath(ownerSpaceId, repositoryId, worktreeId)
          : buildDashboardPath(ownerSpaceId, repositoryId, null);
    return {
      sessionId,
      title: sessionTitle(session),
      cwd: session.cwd,
      ownerSpaceId,
      ownerSpaceName: ownerSpace?.name ?? null,
      ownerArchived,
      repositoryId,
      worktreeId,
      isMainCheckout,
      placementPossible: true,
      placementBlockReason: null,
      repairState,
      canonicalDashboardPath,
      needsChooser: false,
      chooserMode: null,
      discovered: null,
      preview: {
        targetSpaceId: null,
        wouldAttachRepository: false,
        wouldAttachWorktree: false,
        warnings: [],
      },
    };
  }

  const lookup = await lookupSessionCheckout(session);

  let discovered: DiscoveredCheckoutDescriptor | null = null;
  let repositoryId: string | null = null;
  let worktreeId: string | null = null;
  let isMainCheckout: boolean | null = null;
  let repairState: DashboardRepairState | null = null;
  let placementBlockReason: DashboardPlacementBlockReason | null = null;

  if (lookup.kind === "cwd-deleted") {
    placementBlockReason = ownerSpaceId ? null : "cwd-deleted";
    if (ownerSpaceId) repairState = "context-unresolved";
  } else if (lookup.kind === "resolved") {
    discovered = {
      checkoutPath: lookup.checkout.path,
      branch: lookup.checkout.branch,
      isMain: lookup.checkout.isMain,
      repositoryIdentity: lookup.discovered.identity,
      repositoryRootPath: lookup.discovered.rootPath,
      repositoryName: lookup.discovered.name,
    };
    isMainCheckout = lookup.checkout.isMain;
    const worktreeRow = findWorktreeByPath(lookup.checkout.path);
    const repoRow =
      worktreeRow &&
      drizzleDb
        .select()
        .from(repositories)
        .where(eq(repositories.id, worktreeRow.repositoryId))
        .get();
    const repoByIdentity = findRepositoryByIdentity(lookup.discovered.identity);

    if (worktreeRow && repoRow) {
      repositoryId = repoRow.id;
      worktreeId = worktreeRow.id;
    } else if (
      lookup.checkout.isMain &&
      repoByIdentity &&
      realpathSyncSafe(repoByIdentity.rootPath) !== lookup.checkout.path &&
      !worktreeRow
    ) {
      // Same-remote identity exists but this main clone path has no worktree row.
      repositoryId = repoByIdentity.id;
      worktreeId = null;
      repairState = "main-clone-ambiguous";
      placementBlockReason = ownerSpaceId ? null : "main-clone-ambiguous";
    } else {
      // Exact checkout not synced yet — descriptors only (non-mutating).
      repositoryId = repoByIdentity?.id ?? null;
      worktreeId = null;
      if (!worktreeRow) {
        repairState = ownerSpaceId ? "context-unresolved" : null;
      }
    }
  } else if (lookup.kind === "non-git") {
    // Ownership-only still allowed; Git attach will not happen.
    placementBlockReason = null;
  }

  if (ownerMissing) repairState = "owner-missing";
  else if (ownerArchived) repairState = "owner-archived";
  else if (ownerSpaceId && repositoryId) {
    if (!spaceHasRepository(ownerSpaceId, repositoryId)) {
      repairState = "repo-detached";
    } else if (
      worktreeId &&
      isMainCheckout === false &&
      !spaceHasWorktree(ownerSpaceId, worktreeId)
    ) {
      repairState = "worktree-detached";
    }
  } else if (ownerSpaceId && lookup.kind === "resolved" && !worktreeId && repairState == null) {
    repairState = "context-unresolved";
  }

  let placementPossible = true;
  if (!hasActiveSpaces) {
    placementPossible = false;
    placementBlockReason = "no-spaces";
  } else if (!ownerSpaceId && lookup.kind === "cwd-deleted") {
    placementPossible = false;
    placementBlockReason = "cwd-deleted";
  }

  let canonicalDashboardPath: string | null = null;
  let needsChooser = false;
  let chooserMode: "claim" | "move" | null = null;

  if (ownerSpaceId && !ownerArchived && !ownerMissing) {
    if (
      repairState === "repo-detached" ||
      repairState === "worktree-detached" ||
      repairState === "context-unresolved" ||
      repairState === "main-clone-ambiguous"
    ) {
      canonicalDashboardPath = buildDashboardPath(ownerSpaceId, repositoryId, null);
    } else if (repositoryId && worktreeId) {
      canonicalDashboardPath = buildDashboardPath(ownerSpaceId, repositoryId, worktreeId);
    } else {
      canonicalDashboardPath = buildDashboardPath(ownerSpaceId, repositoryId, null);
    }
    needsChooser = false;
  } else if (ownerArchived && ownerSpaceId) {
    needsChooser = placementPossible;
    chooserMode = "move";
  } else if (ownerMissing || !ownerSpaceId) {
    needsChooser = placementPossible;
    chooserMode = "claim";
  }

  const previewTargetForWarnings = previewTarget;
  let wouldAttachRepository = false;
  let wouldAttachWorktree = false;
  const warnings: string[] = [];

  if (previewTargetForWarnings && discovered) {
    const target = drizzleDb
      .select()
      .from(spaces)
      .where(eq(spaces.id, previewTargetForWarnings))
      .get();
    if (target && !target.archived) {
      const existingRepo =
        repositoryId ?? findRepositoryByIdentity(discovered.repositoryIdentity)?.id ?? null;
      const existingWorktree =
        worktreeId ?? findWorktreeByPath(discovered.checkoutPath)?.id ?? null;
      wouldAttachRepository = !(
        existingRepo && spaceHasRepository(previewTargetForWarnings, existingRepo)
      );
      wouldAttachWorktree =
        !discovered.isMain &&
        !(existingWorktree && spaceHasWorktree(previewTargetForWarnings, existingWorktree));
      // No synced row yet → placeSession will sync + attach.
      if (!existingRepo) wouldAttachRepository = true;
      if (!discovered.isMain && !existingWorktree) wouldAttachWorktree = true;

      if (wouldAttachRepository) {
        warnings.push("This repo is new for this space, so it will be attached.");
      } else if (wouldAttachWorktree) {
        warnings.push("This worktree is new for this space, so it will be attached.");
      }
    }
  } else if (previewTargetForWarnings && (lookup.kind === "no-cwd" || lookup.kind === "non-git")) {
    warnings.push("This session has no Git checkout, so nothing will be attached.");
  }

  return {
    sessionId,
    title: sessionTitle(session),
    cwd: session.cwd,
    ownerSpaceId: ownerMissing ? null : ownerSpaceId,
    ownerSpaceName: ownerSpace?.name ?? null,
    ownerArchived,
    repositoryId,
    worktreeId,
    isMainCheckout,
    placementPossible,
    placementBlockReason,
    repairState,
    canonicalDashboardPath,
    needsChooser,
    chooserMode,
    discovered,
    preview: {
      targetSpaceId: previewTargetForWarnings,
      wouldAttachRepository,
      wouldAttachWorktree,
      warnings,
    },
  };
}

/** Sync helper for spaceState: map session cwd → existing worktree via realpath prefix. */
export function resolveExistingWorktreeForCwd(cwd: string | null | undefined): {
  repositoryId: string;
  worktreeId: string;
  isMain: boolean;
  worktreePath: string;
} | null {
  if (!cwd?.trim()) return null;
  const canonical = realpathSyncSafe(cwd);
  if (!canonical) return null;
  const rows = drizzleDb.select().from(worktrees).all();
  const matchedPath = matchCheckoutPath(
    canonical,
    rows.map((row) => row.path),
  );
  const worktree = rows.find((row) => row.path === matchedPath);
  if (!worktree) return null;
  return {
    repositoryId: worktree.repositoryId,
    worktreeId: worktree.id,
    isMain: Boolean(worktree.isMain),
    worktreePath: worktree.path,
  };
}
