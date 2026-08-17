import os from "node:os";
import path from "node:path";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { Clock, Effect } from "effect";
import { drizzleDb, drizzleSqlite } from "./db/index.ts";
import {
  repositories,
  sessions,
  spaceRepositories,
  spaceSessions,
  spaceWorktrees,
  spaces,
  worktrees,
} from "./db/drizzle-schema.ts";
import { broadcastQueue, broadcastSessions } from "./broadcast.ts";
import { createGitWorktree, discoverRepository, type GitRepository } from "./spaces-git.ts";
import { resolveExistingWorktreeForCwd } from "./dashboard-placement.ts";
import { expandPath, lookupSessionCheckout, matchCheckout } from "./session-checkout.ts";
import {
  buildImportableSpaceSession,
  buildSpaceRosterSessionsForOwners,
} from "./space-session-roster.ts";
import { firstActiveSpaceId, flattenSpacesDepthFirst } from "../src/space-sort-order.ts";

function id(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function worktreeName(branch: string, worktreeId: string, worktreePath?: string): string {
  if (branch === "(detached)") {
    const checkoutName = worktreePath ? path.basename(worktreePath).trim() : "";
    return checkoutName || `detached-${worktreeId.slice(-6)}`;
  }
  const base = branch.split("/").filter(Boolean).at(-1) || "detached";
  return base || worktreeId.slice(-6);
}

function worktreeBranchLabel(branch: string): string {
  return branch === "(detached)" ? "Detached HEAD" : branch;
}

function inTransaction<T>(operation: () => T): T {
  return drizzleSqlite.transaction(operation)();
}

type SpaceReparentUpdate = {
  name?: string;
  context?: string;
  parentId: string | null;
  sortOrder?: number;
  updatedAt: SQL;
};
type SyncedRepository = { repositoryId: string; checkoutIds: string[] };

function syncRepositoryRecord(repo: GitRepository): string {
  const current = drizzleDb
    .select()
    .from(repositories)
    .where(eq(repositories.identity, repo.identity))
    .get();
  const repositoryId = current?.id ?? id("repo");
  drizzleDb
    .insert(repositories)
    .values({ id: repositoryId, identity: repo.identity, name: repo.name, rootPath: repo.rootPath })
    .onConflictDoUpdate({
      target: repositories.identity,
      set: { rootPath: repo.rootPath, updatedAt: sql`CURRENT_TIMESTAMP` },
    })
    .run();
  const actualRepository = drizzleDb
    .select()
    .from(repositories)
    .where(eq(repositories.identity, repo.identity))
    .get();
  if (!actualRepository) throw new Error("Unable to persist repository.");
  return actualRepository.id;
}

function syncRepository(repo: GitRepository): SyncedRepository {
  const repositoryId = syncRepositoryRecord(repo);
  const checkoutIds: string[] = [];
  for (const checkout of repo.checkouts) {
    const existing = drizzleDb
      .select()
      .from(worktrees)
      .where(eq(worktrees.path, checkout.path))
      .get();
    const worktreeId = existing?.id ?? id("worktree");
    drizzleDb
      .insert(worktrees)
      .values({
        id: worktreeId,
        path: checkout.path,
        repositoryId,
        branch: checkout.branch,
        isMain: checkout.isMain ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: worktrees.path,
        set: {
          repositoryId,
          branch: checkout.branch,
          isMain: checkout.isMain ? 1 : 0,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .run();
    const actualWorktree = drizzleDb
      .select()
      .from(worktrees)
      .where(eq(worktrees.path, checkout.path))
      .get();
    if (actualWorktree) checkoutIds.push(actualWorktree.id);
  }
  return { repositoryId, checkoutIds };
}

function allSessions() {
  return drizzleDb.select().from(sessions).all();
}

type SpaceStateDeps = {
  /**
   * Test hook: throw before spaceState DB reads so Effect.try can prove
   * SQLite-style failures become SpacesError (Fail), not Cause.Die.
   */
  throwOnRead?: () => void;
};

let spaceStateDeps: SpaceStateDeps = {};

export function setSpaceStateDepsForTest(deps: SpaceStateDeps): void {
  spaceStateDeps = deps;
}

export function resetSpaceStateDepsForTest(): void {
  spaceStateDeps = {};
}

/**
 * Build spaces dashboard state from a single clock snapshot (`now`).
 * Callers must supply `now` from `Clock.currentTimeMillis` (or a test clock) —
 * never `Date.now()` inside this function.
 */
export function spaceState(now: number) {
  spaceStateDeps.throwOnRead?.();
  const spaceRows = drizzleDb.select().from(spaces).all();
  const repositoryRows = drizzleDb.select().from(repositories).all();
  const worktreeRows = drizzleDb.select().from(worktrees).all();
  const sessionRows = allSessions();
  const sessionOwners = drizzleDb.select().from(spaceSessions).all();
  const contextForSession = (session: typeof sessions.$inferSelect) => {
    const resolved = resolveExistingWorktreeForCwd(session.cwd);
    if (!resolved) return undefined;
    const worktree = worktreeRows.find((item) => item.id === resolved.worktreeId);
    const repo = repositoryRows.find((item) => item.id === resolved.repositoryId);
    if (!worktree || !repo) return undefined;
    return {
      repoId: repo.id,
      worktreeId: worktree.id,
      worktree: worktree.isMain
        ? "__primary__"
        : worktreeName(worktree.branch, worktree.id, worktree.path),
    };
  };
  const mappedSpaces = spaceRows.map((space) => {
    const repoLinks = drizzleDb
      .select()
      .from(spaceRepositories)
      .where(eq(spaceRepositories.spaceId, space.id))
      .all();
    const repos = repoLinks.flatMap((link) => {
      const repo = repositoryRows.find((item) => item.id === link.repositoryId);
      if (!repo) return [];
      const repoWorktrees = worktreeRows.filter((item) => item.repositoryId === repo.id);
      const claims = drizzleDb
        .select()
        .from(spaceWorktrees)
        .where(eq(spaceWorktrees.spaceId, space.id))
        .all();
      const claimedIds = new Set(claims.map((claim) => claim.worktreeId));
      const visible = repoWorktrees.filter((item) => item.isMain || claimedIds.has(item.id));
      const primary =
        visible.find((item) => item.isMain) || repoWorktrees.find((item) => item.isMain);
      const names = visible
        .filter((item) => !item.isMain)
        .map((item) => worktreeName(item.branch, item.id, item.path));
      const worktreeIds: Record<string, string> = Object.fromEntries(
        visible.map((item) => [
          item.isMain ? "__primary__" : worktreeName(item.branch, item.id, item.path),
          item.id,
        ]),
      );
      return [
        {
          id: repo.id,
          name: repo.name,
          path: repo.rootPath,
          primaryBranch: primary?.branch || "main",
          primaryWorktreeId: primary?.id,
          worktrees: names,
          availableWorktrees: [],
          availableWorktreeBranches: {},
          worktreeBranches: Object.fromEntries(
            visible
              .filter((item) => !item.isMain)
              .map((item) => [
                worktreeName(item.branch, item.id, item.path),
                worktreeBranchLabel(item.branch),
              ]),
          ),
          worktreePaths: Object.fromEntries(
            visible
              .filter((item) => !item.isMain)
              .map((item) => [worktreeName(item.branch, item.id, item.path), item.path]),
          ),
          worktreeIds,
        },
      ];
    });
    const owned = sessionOwners.filter((owner) => owner.spaceId === space.id);
    const ownedIds = new Set(owned.map((owner) => owner.sessionId));
    const sessionsForSpace = buildSpaceRosterSessionsForOwners(
      owned,
      sessionRows.filter((session) => ownedIds.has(session.id)),
      contextForSession,
      now,
    );
    const visibleWorktreeIds = new Set(
      repos.flatMap((repo) => Object.values(repo.worktreeIds || {})),
    );
    const importableSessions = sessionRows
      .filter((session) => {
        if (sessionOwners.some((owner) => owner.sessionId === session.id)) return false;
        const resolved = resolveExistingWorktreeForCwd(session.cwd);
        return Boolean(resolved && visibleWorktreeIds.has(resolved.worktreeId));
      })
      .map((session) => buildImportableSpaceSession(session, now, contextForSession(session)));
    return {
      id: space.id,
      name: space.name,
      parentId: space.parentId,
      archived: Boolean(space.archived),
      context: space.context,
      defaultProvider: space.defaultProvider || undefined,
      defaultModel: space.defaultModel || undefined,
      access: space.access as "private" | "shared",
      sortOrder: space.sortOrder,
      repos,
      sessions: sessionsForSpace,
      importableSessions,
    };
  });

  return {
    selectedSpaceId: firstActiveSpaceId(mappedSpaces),
    // Depth-first Organize order so flat consumers (picker, defaults) match the tree.
    spaces: flattenSpacesDepthFirst(mappedSpaces, { includeArchived: true }),
  };
}

/**
 * Effect roster boundary: take one Clock snapshot, then run spaceState(now).
 * Sync DB work inside spaceState is Effect.try-wrapped so SQLite throws are
 * SpacesError on the E channel (catchAll-visible), not Cause.Die defects.
 */
export const readSpaceState = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  return yield* Effect.try({
    try: () => spaceState(now),
    catch: toSpacesError,
  });
});

/** Promise callers (mutations) take one Live/Test Clock snapshot then build state. */
export async function spaceStateNow() {
  const now = await Effect.runPromise(Clock.currentTimeMillis);
  return spaceState(now);
}

function requireSpace(spaceId: string, includeArchived = false) {
  const space = drizzleDb.select().from(spaces).where(eq(spaces.id, spaceId)).get();
  if (!space || (!includeArchived && space.archived)) fail("Space not found.", 404);
  return space;
}

function nextSortOrderAmongSiblings(parentId: string | null): number {
  const siblings = drizzleDb
    .select()
    .from(spaces)
    .all()
    .filter((space) => (space.parentId ?? null) === parentId);
  return siblings.reduce((max, space) => Math.max(max, space.sortOrder), -1) + 1;
}

/**
 * Move a space under a new parent (or keep parent) with a collision-free sortOrder.
 * When the parent changes, append at max+1 in the destination sibling group.
 */
function reparentSpaceTransactional(
  spaceId: string,
  parentId: string | null,
  fields?: { name?: string; context?: string },
): void {
  if (parentId) {
    requireSpace(parentId);
    if (parentId === spaceId) fail("A space cannot be its own parent.");
    if (descendantsOf(spaceId).has(parentId)) fail("A space cannot move inside its own subtree.");
  }
  const current = requireSpace(spaceId, true);
  const previousParent = current.parentId ?? null;
  const parentChanged = previousParent !== parentId;
  inTransaction(() => {
    const update: SpaceReparentUpdate = {
      parentId,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    };
    if (fields?.name !== undefined) update.name = fields.name;
    if (fields?.context !== undefined) update.context = fields.context;
    if (parentChanged) update.sortOrder = nextSortOrderAmongSiblings(parentId);
    drizzleDb.update(spaces).set(update).where(eq(spaces.id, spaceId)).run();
  });
}

function ensureSession(sessionId: string) {
  const session = drizzleDb.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) fail("Session not found.", 404);
  return session;
}

export type SpaceAction = {
  action:
    | "update"
    | "delete"
    | "archive"
    | "restore"
    | "move"
    | "reorderSiblings"
    | "attachRepository"
    | "releaseRepository"
    | "updateRepository"
    | "discoverWorktrees"
    | "createWorktree"
    | "claimWorktree"
    | "releaseWorktree"
    | "releaseAllWorktrees"
    | "claimSession"
    | "releaseSession"
    | "moveSession"
    | "placeSession";
  name?: string;
  context?: string;
  parentId?: string | null;
  path?: string;
  repoId?: string;
  branch?: string;
  base?: string;
  parentPath?: string;
  worktree?: string;
  sessionId?: string;
  targetSpaceId?: string;
  mode?: "claim" | "move";
  expectedOwnerSpaceId?: string;
  /** Full sibling id list in desired order (same parent). */
  orderedIds?: readonly string[];
};

export type SpacesError = {
  _tag: "SpacesError";
  error: string;
  status: number;
};

function fail(error: string, status = 400): never {
  throw Object.assign(new Error(error), { status });
}

export function toSpacesError(error: unknown): SpacesError {
  if (
    error &&
    typeof error === "object" &&
    "_tag" in error &&
    error._tag === "SpacesError" &&
    "error" in error &&
    typeof error.error === "string" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return { _tag: "SpacesError", error: error.error, status: error.status };
  }
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    const message = error instanceof Error ? error.message : "Spaces request failed.";
    return {
      _tag: "SpacesError",
      error: message,
      status: error.status,
    };
  }
  return {
    _tag: "SpacesError",
    error: error instanceof Error ? error.message : String(error),
    status: /already imported|already exists|already checked out/i.test(String(error)) ? 409 : 400,
  };
}

function required(value: string | undefined, label: string): string {
  const result = value?.trim();
  if (!result) fail(label + " is required.");
  return result;
}

function buildCanonicalDashboardPath(
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

export type PlaceSessionResult = {
  state: ReturnType<typeof spaceState>;
  placement: {
    spaceId: string;
    repositoryId: string | null;
    worktreeId: string | null;
    isMainCheckout: boolean | null;
    canonicalDashboardPath: string;
    attachedRepository: boolean;
    attachedWorktree: boolean;
  };
};

async function placeSession(
  targetSpaceId: string,
  input: {
    sessionId: string;
    mode: "claim" | "move";
    expectedOwnerSpaceId?: string;
  },
): Promise<PlaceSessionResult> {
  requireSpace(targetSpaceId);
  const sessionId = required(input.sessionId, "Session");
  const session = ensureSession(sessionId);
  const mode = input.mode;

  if (mode === "move") {
    const expected = required(input.expectedOwnerSpaceId, "Expected owner space");
    // Snapshot for CAS after async discovery.
    const ownerBefore = drizzleDb
      .select()
      .from(spaceSessions)
      .where(eq(spaceSessions.sessionId, sessionId))
      .get();
    if (!ownerBefore) fail("Session is not imported into a space.", 409);
    if (ownerBefore.spaceId !== expected && ownerBefore.spaceId !== targetSpaceId) {
      fail("Session owner changed. Refresh and try again.", 409);
    }
  }

  const lookup = await lookupSessionCheckout(session);
  if (lookup.kind === "cwd-deleted") fail("Session cwd does not exist.", 409);

  let discovered: GitRepository | null = null;
  let checkout: ReturnType<typeof matchCheckout> = null;
  let toplevelPath: string | null = null;
  if (lookup.kind === "resolved") {
    discovered = lookup.discovered;
    checkout = lookup.checkout;
    toplevelPath = lookup.checkout.path;
  }

  const snapshotCwd = session.cwd ?? null;

  const result = inTransaction(() => {
    const sessionNow = drizzleDb.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (!sessionNow) fail("Session not found.", 404);
    if ((sessionNow.cwd ?? null) !== snapshotCwd) {
      fail("Session cwd changed. Refresh and try again.", 409);
    }

    const owner = drizzleDb
      .select()
      .from(spaceSessions)
      .where(eq(spaceSessions.sessionId, sessionId))
      .get();

    if (mode === "claim") {
      if (owner && owner.spaceId !== targetSpaceId) {
        fail("Session is already imported into another space.", 409);
      }
    } else {
      const expected = required(input.expectedOwnerSpaceId, "Expected owner space");
      if (!owner) fail("Session is not imported into a space.", 409);
      if (owner.spaceId !== expected && owner.spaceId !== targetSpaceId) {
        fail("Session owner changed. Refresh and try again.", 409);
      }
    }

    let repositoryId: string | null = null;
    let worktreeId: string | null = null;
    let isMainCheckout: boolean | null = null;
    let attachedRepository = false;
    let attachedWorktree = false;

    if (discovered && checkout && toplevelPath) {
      const synced = syncRepository(discovered);
      repositoryId = synced.repositoryId;
      isMainCheckout = checkout.isMain;

      const hadRepo = Boolean(
        drizzleDb
          .select()
          .from(spaceRepositories)
          .where(
            and(
              eq(spaceRepositories.spaceId, targetSpaceId),
              eq(spaceRepositories.repositoryId, repositoryId),
            ),
          )
          .get(),
      );

      drizzleDb
        .insert(spaceRepositories)
        .values({ spaceId: targetSpaceId, repositoryId })
        .onConflictDoNothing()
        .run();
      attachedRepository = !hadRepo;

      const importedWorktree = drizzleDb
        .select()
        .from(worktrees)
        .where(eq(worktrees.path, toplevelPath))
        .get();
      if (!importedWorktree) fail("Session worktree was not found after Git discovery.", 500);
      worktreeId = importedWorktree.id;

      if (!checkout.isMain) {
        const hadWorktree = Boolean(
          drizzleDb
            .select()
            .from(spaceWorktrees)
            .where(
              and(
                eq(spaceWorktrees.spaceId, targetSpaceId),
                eq(spaceWorktrees.worktreeId, worktreeId),
              ),
            )
            .get(),
        );
        drizzleDb
          .insert(spaceWorktrees)
          .values({ spaceId: targetSpaceId, worktreeId })
          .onConflictDoNothing()
          .run();
        attachedWorktree = !hadWorktree;
      }
    }

    if (owner && owner.spaceId === targetSpaceId) {
      // Idempotent same-target.
    } else if (owner) {
      drizzleDb
        .update(spaceSessions)
        .set({ spaceId: targetSpaceId })
        .where(eq(spaceSessions.sessionId, sessionId))
        .run();
    } else {
      drizzleDb.insert(spaceSessions).values({ sessionId, spaceId: targetSpaceId }).run();
    }

    const finalOwner = drizzleDb
      .select()
      .from(spaceSessions)
      .where(eq(spaceSessions.sessionId, sessionId))
      .get();
    if (!finalOwner || finalOwner.spaceId !== targetSpaceId) {
      fail("Failed to place session into target space.", 500);
    }

    return {
      repositoryId,
      worktreeId,
      isMainCheckout,
      attachedRepository,
      attachedWorktree,
    };
  });

  // Roll back semantics: inTransaction already rolls back on throw.

  broadcastQueue(sessionId);
  broadcastSessions();

  return {
    state: await spaceStateNow(),
    placement: {
      spaceId: targetSpaceId,
      repositoryId: result.repositoryId,
      worktreeId: result.worktreeId,
      isMainCheckout: result.isMainCheckout,
      canonicalDashboardPath: buildCanonicalDashboardPath(
        targetSpaceId,
        result.repositoryId,
        result.worktreeId,
      ),
      attachedRepository: result.attachedRepository,
      attachedWorktree: result.attachedWorktree,
    },
  };
}

async function moveSessionToSpace(sessionId: string, targetSpaceId: string) {
  const owner = drizzleDb
    .select()
    .from(spaceSessions)
    .where(eq(spaceSessions.sessionId, sessionId))
    .get();
  if (!owner) fail("Session is not imported into a space.", 409);
  return placeSession(targetSpaceId, {
    sessionId,
    mode: "move",
    expectedOwnerSpaceId: owner.spaceId,
  });
}

function descendantsOf(spaceId: string): Set<string> {
  const descendants = new Set([spaceId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of drizzleDb.select().from(spaces).all()) {
      if (
        candidate.parentId &&
        descendants.has(candidate.parentId) &&
        !descendants.has(candidate.id)
      ) {
        descendants.add(candidate.id);
        changed = true;
      }
    }
  }
  return descendants;
}

export async function createSpace(input: {
  name: string;
  context: string;
  parentId: string | null;
}) {
  const name = required(input.name, "Space name");
  const parent = input.parentId ? requireSpace(input.parentId) : undefined;
  const newId = id("space");
  inTransaction(() => {
    drizzleDb
      .insert(spaces)
      .values({
        id: newId,
        name,
        parentId: input.parentId,
        context: input.context,
        sortOrder: nextSortOrderAmongSiblings(input.parentId ?? null),
      })
      .run();
    if (parent) {
      const parentRepositories = drizzleDb
        .select()
        .from(spaceRepositories)
        .where(eq(spaceRepositories.spaceId, parent.id))
        .all();
      if (parentRepositories.length) {
        drizzleDb
          .insert(spaceRepositories)
          .values(
            parentRepositories.map((repository) => ({
              spaceId: newId,
              repositoryId: repository.repositoryId,
              sortOrder: repository.sortOrder,
            })),
          )
          .onConflictDoNothing()
          .run();
      }
    }
  });
  const nextState = await spaceStateNow();
  nextState.selectedSpaceId = newId;
  broadcastSessions();
  return { state: nextState, spaceId: newId };
}

export async function applySpaceAction(spaceId: string, input: SpaceAction) {
  requireSpace(spaceId, input.action === "restore");

  if (input.action === "placeSession") {
    const mode = input.mode === "move" ? "move" : "claim";
    return placeSession(spaceId, {
      sessionId: required(input.sessionId, "Session"),
      mode,
      expectedOwnerSpaceId: input.expectedOwnerSpaceId,
    });
  }

  if (input.action === "moveSession") {
    return moveSessionToSpace(required(input.sessionId, "Session"), spaceId);
  }

  if (input.action === "update") {
    const name = required(input.name, "Space name");
    const parentId = input.parentId || null;
    reparentSpaceTransactional(spaceId, parentId, { name, context: input.context ?? "" });
    const nextState = await spaceStateNow();
    broadcastSessions();
    return { state: nextState };
  }

  if (input.action === "delete") {
    const descendants = descendantsOf(spaceId);
    inTransaction(() => {
      for (const descendantId of descendants) {
        drizzleDb.delete(spaces).where(eq(spaces.id, descendantId)).run();
      }
    });
    const nextState = await spaceStateNow();
    broadcastSessions();
    return { state: nextState };
  }

  if (input.action === "archive" || input.action === "restore") {
    drizzleDb
      .update(spaces)
      .set({ archived: input.action === "archive" ? 1 : 0, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(spaces.id, spaceId))
      .run();
    const nextState = await spaceStateNow();
    broadcastSessions();
    return { state: nextState };
  }

  if (input.action === "move") {
    const parentId = input.parentId || null;
    reparentSpaceTransactional(spaceId, parentId);
    const nextState = await spaceStateNow();
    broadcastSessions();
    return { state: nextState };
  }

  if (input.action === "reorderSiblings") {
    const orderedIds = input.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      fail("orderedIds must be a non-empty array of sibling space ids.");
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      fail("orderedIds must not contain duplicates.");
    }
    if (!orderedIds.includes(spaceId)) {
      fail("Path spaceId must be included in orderedIds.");
    }
    const rows = orderedIds.map((idValue) => {
      const row = drizzleDb.select().from(spaces).where(eq(spaces.id, idValue)).get();
      if (!row) fail(`Space not found: ${idValue}`, 404);
      if (row.archived) fail("Cannot reorder an archived space.");
      return row;
    });
    const parentId = rows[0].parentId ?? null;
    if (rows.some((row) => (row.parentId ?? null) !== parentId)) {
      fail("orderedIds must all share the same parent.");
    }
    const siblings = drizzleDb
      .select()
      .from(spaces)
      .all()
      .filter((space) => (space.parentId ?? null) === parentId);
    const activeSiblingIds = new Set(
      siblings.filter((space) => !space.archived).map((space) => space.id),
    );
    if (
      orderedIds.length !== activeSiblingIds.size ||
      orderedIds.some((idValue) => !activeSiblingIds.has(idValue))
    ) {
      fail("orderedIds must list every active sibling under that parent exactly once.");
    }
    const archived = siblings
      .filter((space) => space.archived)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    inTransaction(() => {
      orderedIds.forEach((idValue, index) => {
        drizzleDb
          .update(spaces)
          .set({ sortOrder: index, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(spaces.id, idValue))
          .run();
      });
      archived.forEach((space, index) => {
        drizzleDb
          .update(spaces)
          .set({
            sortOrder: orderedIds.length + index,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(spaces.id, space.id))
          .run();
      });
    });
    const nextState = await spaceStateNow();
    broadcastSessions();
    return { state: nextState };
  }

  if (input.action === "attachRepository") {
    const repoPath = required(input.path, "Repository path");
    const discovered = await discoverRepository(repoPath);
    const requestedCheckout = discovered.checkouts.find(
      (checkout) => checkout.path === discovered.requestedPath,
    );
    if (!requestedCheckout) fail("Path is not a Git repository or worktree checkout.");
    const mainCheckout = discovered.checkouts.find((checkout) => checkout.isMain);
    const repo = {
      ...discovered,
      checkouts: requestedCheckout.isMain
        ? [requestedCheckout]
        : [mainCheckout, requestedCheckout].filter(
            (checkout): checkout is typeof requestedCheckout => Boolean(checkout),
          ),
    };
    const repositoryId = inTransaction(() => {
      const existingRepository = drizzleDb
        .select()
        .from(repositories)
        .where(eq(repositories.identity, repo.identity))
        .get();
      const repositoryId = syncRepository(repo).repositoryId;
      const existingLink = drizzleDb
        .select()
        .from(spaceRepositories)
        .where(
          and(
            eq(spaceRepositories.spaceId, spaceId),
            eq(spaceRepositories.repositoryId, repositoryId),
          ),
        )
        .get();
      drizzleDb
        .insert(spaceRepositories)
        .values({ spaceId, repositoryId })
        .onConflictDoNothing()
        .run();
      if (!requestedCheckout.isMain) {
        const importedWorktree = drizzleDb
          .select()
          .from(worktrees)
          .where(eq(worktrees.path, requestedCheckout.path))
          .get();
        if (!importedWorktree) fail("Imported worktree was not found after Git discovery.", 500);
        drizzleDb
          .insert(spaceWorktrees)
          .values({ spaceId, worktreeId: importedWorktree.id })
          .onConflictDoNothing()
          .run();
      }
      const displayName = requestedCheckout.isMain
        ? input.name?.trim() || existingRepository?.name || repo.name
        : existingRepository?.name || repo.name;
      if (requestedCheckout.isMain) {
        drizzleDb
          .update(repositories)
          .set({ name: displayName })
          .where(eq(repositories.id, repositoryId))
          .run();
      }
      return { repositoryId, createdLink: !existingLink };
    });
    return { state: await spaceStateNow(), ...repositoryId };
  }

  if (input.action === "releaseRepository") {
    const repoId = required(input.repoId, "Repository");
    // Phase 1: snapshot owned sessions + cwds (no Git inside txn).
    const owned = drizzleDb
      .select()
      .from(spaceSessions)
      .where(eq(spaceSessions.spaceId, spaceId))
      .all();
    const sessionSnapshots = owned.map((owner) => {
      const session = drizzleDb
        .select()
        .from(sessions)
        .where(eq(sessions.id, owner.sessionId))
        .get();
      return {
        sessionId: owner.sessionId,
        spaceId: owner.spaceId,
        cwd: session?.cwd ?? null,
        title: session?.alias || session?.opencodeProjectName || owner.sessionId,
      };
    });
    const attachmentSnapshot = drizzleDb
      .select()
      .from(spaceRepositories)
      .where(
        and(eq(spaceRepositories.spaceId, spaceId), eq(spaceRepositories.repositoryId, repoId)),
      )
      .get();
    if (!attachmentSnapshot) return { state: await spaceStateNow() };

    // Phase 1b: resolve Git outside txn.
    const dependents: string[] = [];
    for (const snap of sessionSnapshots) {
      const lookup = await lookupSessionCheckout({ cwd: snap.cwd });
      if (lookup.kind !== "resolved") continue;
      const worktree = drizzleDb
        .select()
        .from(worktrees)
        .where(eq(worktrees.path, lookup.checkout.path))
        .get();
      if (worktree?.repositoryId === repoId) dependents.push(snap.title);
    }

    // Phase 2: CAS + delete in one sync txn.
    inTransaction(() => {
      const linkNow = drizzleDb
        .select()
        .from(spaceRepositories)
        .where(
          and(eq(spaceRepositories.spaceId, spaceId), eq(spaceRepositories.repositoryId, repoId)),
        )
        .get();
      if (!linkNow) fail("Repository attachment changed. Refresh and try again.", 409);

      for (const snap of sessionSnapshots) {
        const ownerNow = drizzleDb
          .select()
          .from(spaceSessions)
          .where(eq(spaceSessions.sessionId, snap.sessionId))
          .get();
        const sessionNow = drizzleDb
          .select()
          .from(sessions)
          .where(eq(sessions.id, snap.sessionId))
          .get();
        if (
          !ownerNow ||
          ownerNow.spaceId !== snap.spaceId ||
          (sessionNow?.cwd ?? null) !== snap.cwd
        ) {
          fail("Session ownership or cwd changed. Refresh and try again.", 409);
        }
      }

      if (dependents.length) {
        fail(
          `Cannot detach repository while sessions still use it: ${dependents.join(", ")}.`,
          409,
        );
      }

      const repositoryWorktrees = drizzleDb
        .select()
        .from(worktrees)
        .where(eq(worktrees.repositoryId, repoId))
        .all();
      for (const worktree of repositoryWorktrees) {
        drizzleDb
          .delete(spaceWorktrees)
          .where(
            and(eq(spaceWorktrees.spaceId, spaceId), eq(spaceWorktrees.worktreeId, worktree.id)),
          )
          .run();
      }
      drizzleDb
        .delete(spaceRepositories)
        .where(
          and(eq(spaceRepositories.spaceId, spaceId), eq(spaceRepositories.repositoryId, repoId)),
        )
        .run();
    });
    return { state: await spaceStateNow() };
  }

  if (input.action === "updateRepository") {
    const repoId = required(input.repoId, "Repository");
    const repoPath = required(input.path, "Repository path");
    const name = required(input.name, "Repository name");
    const existingLink = drizzleDb
      .select()
      .from(spaceRepositories)
      .where(
        and(eq(spaceRepositories.spaceId, spaceId), eq(spaceRepositories.repositoryId, repoId)),
      )
      .get();
    if (!existingLink) fail("Repository is not attached to this space.", 404);
    const repo = await discoverRepository(repoPath);
    const existingRepository = drizzleDb
      .select()
      .from(repositories)
      .where(eq(repositories.identity, repo.identity))
      .get();
    if (!existingRepository || existingRepository.id !== repoId) {
      fail("Path belongs to a different repository.", 409);
    }
    inTransaction(() => {
      syncRepository(repo);
      drizzleDb
        .update(repositories)
        .set({ name, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(repositories.id, repoId))
        .run();
    });
    return { state: await spaceStateNow() };
  }

  if (input.action === "discoverWorktrees") {
    const repoId = required(input.repoId, "Repository");
    const link = drizzleDb
      .select()
      .from(spaceRepositories)
      .where(
        and(eq(spaceRepositories.spaceId, spaceId), eq(spaceRepositories.repositoryId, repoId)),
      )
      .get();
    if (!link) fail("Repository is not attached to this space.", 409);
    const repository = drizzleDb
      .select()
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .get();
    if (!repository) fail("Repository not found.", 404);
    const discovered = await discoverRepository(repository.rootPath);
    if (discovered.identity !== repository.identity) {
      fail("Path belongs to a different repository.", 409);
    }
    inTransaction(() => {
      const { checkoutIds } = syncRepository(discovered);
      for (const [index, checkout] of discovered.checkouts.entries()) {
        if (checkout.isMain) continue;
        const worktreeId = checkoutIds[index];
        if (!worktreeId) fail("Discovered worktree was not persisted.", 500);
        drizzleDb
          .insert(spaceWorktrees)
          .values({ spaceId, worktreeId })
          .onConflictDoNothing()
          .run();
      }
    });
    return { state: await spaceStateNow() };
  }

  if (input.action === "createWorktree") {
    const repoId = required(input.repoId, "Repository");
    const branch = required(input.branch, "Branch");
    const base = input.base?.trim() || "HEAD";
    const repo = drizzleDb.select().from(repositories).where(eq(repositories.id, repoId)).get();
    if (!repo) fail("Repository not found.");
    const link = drizzleDb
      .select()
      .from(spaceRepositories)
      .where(
        and(eq(spaceRepositories.spaceId, spaceId), eq(spaceRepositories.repositoryId, repoId)),
      )
      .get();
    if (!link) fail("Repository is not attached to this space.", 409);
    const parent = expandPath(input.parentPath?.trim() || os.tmpdir());
    const destination = path.join(parent, `${repo.name}-${branch.replaceAll("/", "-")}`);
    const createdPath = await createGitWorktree(repo.rootPath, branch, destination, base);
    const discovered = await discoverRepository(repo.rootPath);
    inTransaction(() => {
      syncRepository(discovered);
      const created = drizzleDb
        .select()
        .from(worktrees)
        .where(eq(worktrees.path, createdPath))
        .get();
      if (!created) fail("Created worktree was not found after Git discovery.", 500);
      drizzleDb
        .insert(spaceWorktrees)
        .values({ spaceId, worktreeId: created.id })
        .onConflictDoNothing()
        .run();
    });
    return { state: await spaceStateNow() };
  }

  if (input.action === "claimWorktree") {
    const repoId = required(input.repoId, "Repository");
    const requestedWorktree = required(input.worktree, "Worktree");
    const link = drizzleDb
      .select()
      .from(spaceRepositories)
      .where(
        and(eq(spaceRepositories.spaceId, spaceId), eq(spaceRepositories.repositoryId, repoId)),
      )
      .get();
    if (!link) fail("Repository is not attached to this space.", 409);
    const match = drizzleDb
      .select()
      .from(worktrees)
      .where(eq(worktrees.repositoryId, repoId))
      .all()
      .find(
        (worktree) =>
          !worktree.isMain &&
          (worktree.branch === requestedWorktree ||
            worktreeName(worktree.branch, worktree.id, worktree.path) === requestedWorktree),
      );
    if (!match) fail("Worktree not found.", 404);
    inTransaction(() => {
      drizzleDb
        .insert(spaceWorktrees)
        .values({ spaceId, worktreeId: match.id })
        .onConflictDoNothing()
        .run();
    });
    return { state: await spaceStateNow() };
  }

  if (input.action === "releaseWorktree") {
    const repoId = required(input.repoId, "Repository");
    const branchName = required(input.worktree, "Worktree");
    const match = drizzleDb
      .select()
      .from(worktrees)
      .where(eq(worktrees.repositoryId, repoId))
      .all()
      .find(
        (worktree) =>
          worktree.branch === branchName ||
          worktreeName(worktree.branch, worktree.id, worktree.path) === branchName,
      );
    if (!match) return { state: await spaceStateNow() };

    const owned = drizzleDb
      .select()
      .from(spaceSessions)
      .where(eq(spaceSessions.spaceId, spaceId))
      .all();
    const sessionSnapshots = owned.map((owner) => {
      const session = drizzleDb
        .select()
        .from(sessions)
        .where(eq(sessions.id, owner.sessionId))
        .get();
      return {
        sessionId: owner.sessionId,
        spaceId: owner.spaceId,
        cwd: session?.cwd ?? null,
        title: session?.alias || session?.opencodeProjectName || owner.sessionId,
      };
    });
    const claimSnapshot = drizzleDb
      .select()
      .from(spaceWorktrees)
      .where(and(eq(spaceWorktrees.spaceId, spaceId), eq(spaceWorktrees.worktreeId, match.id)))
      .get();
    if (!claimSnapshot) return { state: await spaceStateNow() };

    const dependents: string[] = [];
    for (const snap of sessionSnapshots) {
      const lookup = await lookupSessionCheckout({ cwd: snap.cwd });
      if (lookup.kind !== "resolved") continue;
      if (lookup.checkout.path === match.path) dependents.push(snap.title);
    }

    inTransaction(() => {
      const claimNow = drizzleDb
        .select()
        .from(spaceWorktrees)
        .where(and(eq(spaceWorktrees.spaceId, spaceId), eq(spaceWorktrees.worktreeId, match.id)))
        .get();
      if (!claimNow) fail("Worktree claim changed. Refresh and try again.", 409);

      for (const snap of sessionSnapshots) {
        const ownerNow = drizzleDb
          .select()
          .from(spaceSessions)
          .where(eq(spaceSessions.sessionId, snap.sessionId))
          .get();
        const sessionNow = drizzleDb
          .select()
          .from(sessions)
          .where(eq(sessions.id, snap.sessionId))
          .get();
        if (
          !ownerNow ||
          ownerNow.spaceId !== snap.spaceId ||
          (sessionNow?.cwd ?? null) !== snap.cwd
        ) {
          fail("Session ownership or cwd changed. Refresh and try again.", 409);
        }
      }

      if (dependents.length) {
        fail(`Cannot detach worktree while sessions still use it: ${dependents.join(", ")}.`, 409);
      }

      drizzleDb
        .delete(spaceWorktrees)
        .where(and(eq(spaceWorktrees.spaceId, spaceId), eq(spaceWorktrees.worktreeId, match.id)))
        .run();
    });
    return { state: await spaceStateNow() };
  }

  if (input.action === "releaseAllWorktrees") {
    const repoId = required(input.repoId, "Repository");
    inTransaction(() => {
      const repositoryWorktrees = drizzleDb
        .select()
        .from(worktrees)
        .where(eq(worktrees.repositoryId, repoId))
        .all();
      for (const worktree of repositoryWorktrees) {
        drizzleDb
          .delete(spaceWorktrees)
          .where(
            and(eq(spaceWorktrees.spaceId, spaceId), eq(spaceWorktrees.worktreeId, worktree.id)),
          )
          .run();
      }
    });
    return { state: await spaceStateNow() };
  }

  if (input.action === "claimSession") {
    return placeSession(spaceId, {
      sessionId: required(input.sessionId, "Session"),
      mode: "claim",
    });
  }

  if (input.action === "releaseSession") {
    const sessionId = required(input.sessionId, "Session");
    drizzleDb
      .delete(spaceSessions)
      .where(and(eq(spaceSessions.spaceId, spaceId), eq(spaceSessions.sessionId, sessionId)))
      .run();
    broadcastQueue(sessionId);
    broadcastSessions();
    return { state: await spaceStateNow() };
  }

  fail("Spaces action not found.", 404);
}
