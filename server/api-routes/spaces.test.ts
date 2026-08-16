import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-spaces-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const execFileAsync = promisify(execFile);
const { dispatchEffectApiRequest } = await import("./effect-api.ts");
const { drizzleDb, drizzleSqlite } = await import("../db/index.ts");
const {
  repositories,
  sessions,
  spaceRepositories,
  spaceSessions,
  spaceWorktrees,
  spaces,
  worktrees,
} = await import("../db/drizzle-schema.ts");

async function action(spaceId: string, payload: Record<string, unknown>) {
  return dispatchEffectApiRequest(
    new Request(`http://say.local/api/spaces/${spaceId}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

describe("Spaces API regressions", () => {
  let alternateRepositoryPath = "";
  let featureWorktreePath = "";

  beforeAll(async () => {
    alternateRepositoryPath = mkdtempSync(path.join(tmpdir(), "say-to-me-spaces-repo-"));
    await execFileAsync("git", ["init", "-q", alternateRepositoryPath]);
    await execFileAsync("git", [
      "-C",
      alternateRepositoryPath,
      "config",
      "user.email",
      "test@example.com",
    ]);
    await execFileAsync("git", [
      "-C",
      alternateRepositoryPath,
      "config",
      "user.name",
      "Spaces Test",
    ]);
    await execFileAsync("git", [
      "-C",
      alternateRepositoryPath,
      "remote",
      "add",
      "origin",
      "https://example.com/alternate.git",
    ]);
    await execFileAsync("git", [
      "-C",
      alternateRepositoryPath,
      "commit",
      "--allow-empty",
      "-m",
      "initial",
    ]);
    featureWorktreePath = path.join(tmpdir(), `say-to-me-feature-worktree-${Date.now()}`);
    await execFileAsync("git", [
      "-C",
      alternateRepositoryPath,
      "worktree",
      "add",
      "-q",
      "-b",
      "feature/hidden",
      featureWorktreePath,
    ]);
  });

  afterAll(async () => {
    if (featureWorktreePath) {
      await execFileAsync("git", [
        "-C",
        alternateRepositoryPath,
        "worktree",
        "remove",
        "--force",
        featureWorktreePath,
      ]).catch(() => undefined);
    }
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
    if (alternateRepositoryPath) rmSync(alternateRepositoryPath, { force: true, recursive: true });
  });

  it("seeds a Default space on first database initialization", async () => {
    const response = await dispatchEffectApiRequest(new Request("http://say.local/api/spaces"));
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      state: {
        spaces: Array<{ id: string; name: string; parentId: string | null; archived: boolean }>;
        selectedSpaceId: string;
      };
    };
    expect(body.state.spaces).toHaveLength(1);
    expect(body.state.spaces[0]).toMatchObject({
      id: "space-default",
      name: "Default",
      parentId: null,
      archived: false,
    });
    expect(body.state.selectedSpaceId).toBe("space-default");
  });

  it("does not recreate the default space after the last space is deleted", async () => {
    const existing = drizzleDb.select().from(spaces).all();
    expect(existing.length).toBeGreaterThan(0);

    for (const space of existing) {
      drizzleDb.delete(spaces).where(eq(spaces.id, space.id)).run();
    }
    expect(drizzleDb.select().from(spaces).all()).toEqual([]);

    const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");
    const pathMod = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const migrationsFolder = pathMod.resolve(
      pathMod.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "drizzle",
    );
    migrate(drizzleDb, { migrationsFolder });
    expect(drizzleDb.select().from(spaces).all()).toEqual([]);

    const response = await dispatchEffectApiRequest(new Request("http://say.local/api/spaces"));
    const body = (await response!.json()) as {
      state: { spaces: unknown[]; selectedSpaceId: string };
    };
    expect(body.state.spaces).toEqual([]);
    expect(body.state.selectedSpaceId).toBe("");
  });

  it("publishes typed success and conflict responses in OpenAPI", async () => {
    const response = await dispatchEffectApiRequest(new Request("http://say.local/openapi.json"));
    const body: unknown = await response!.json();
    expect(body).toMatchObject({
      paths: {
        "/api/spaces/{spaceId}/action": {
          post: {
            responses: {
              "200": expect.anything(),
              "400": expect.anything(),
              "404": expect.anything(),
              "409": expect.anything(),
              "500": expect.anything(),
            },
          },
        },
      },
    });
  });

  it("deletes a space together with all descendants", async () => {
    const parentId = "test-space-delete-parent";
    const childId = "test-space-delete-child";
    const grandchildId = "test-space-delete-grandchild";
    drizzleDb
      .insert(spaces)
      .values([
        { id: parentId, name: "Parent", parentId: null },
        { id: childId, name: "Child", parentId },
        { id: grandchildId, name: "Grandchild", parentId: childId },
      ])
      .run();

    const response = await action(parentId, { action: "delete" });

    expect(response?.status).toBe(200);
    expect(
      drizzleDb
        .select()
        .from(spaces)
        .all()
        .map((space) => space.id),
    ).not.toEqual(expect.arrayContaining([parentId, childId, grandchildId]));
  });

  it("inherits parent repositories without inheriting worktree claims", async () => {
    const parentId = "test-space-inherit-parent";
    const repositoryId = "test-repository-inherited";
    const mainWorktreeId = "test-worktree-inherited-main";
    const featureWorktreeId = "test-worktree-inherited-feature";
    drizzleDb.insert(spaces).values({ id: parentId, name: "Parent" }).run();
    drizzleDb
      .insert(repositories)
      .values({
        id: repositoryId,
        identity: "https://example.com/inherited.git",
        name: "inherited",
        rootPath: alternateRepositoryPath,
      })
      .run();
    drizzleDb
      .insert(worktrees)
      .values([
        {
          id: mainWorktreeId,
          path: alternateRepositoryPath,
          repositoryId,
          branch: "main",
          isMain: 1,
        },
        {
          id: featureWorktreeId,
          path: featureWorktreePath,
          repositoryId,
          branch: "feature/hidden",
          isMain: 0,
        },
      ])
      .run();
    drizzleDb.insert(spaceRepositories).values({ spaceId: parentId, repositoryId }).run();
    drizzleDb
      .insert(spaceWorktrees)
      .values({ spaceId: parentId, worktreeId: featureWorktreeId })
      .run();

    const response = await dispatchEffectApiRequest(
      new Request("http://say.local/api/spaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Child", context: "", parentId }),
      }),
    );

    expect(response?.status).toBe(201);
    const body = (await response!.json()) as { state: { selectedSpaceId: string } };
    const childId = body.state.selectedSpaceId;
    expect(drizzleDb.select().from(spaceRepositories).all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ spaceId: childId, repositoryId })]),
    );
    expect(drizzleDb.select().from(spaceWorktrees).all()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ spaceId: childId })]),
    );
  });

  it("validates repository identity before editing or attaching", async () => {
    const spaceId = "test-space-atomic-repository";
    const repositoryId = "test-repository-original";
    drizzleDb.insert(spaces).values({ id: spaceId, name: "Atomic repository" }).run();
    drizzleDb
      .insert(repositories)
      .values({
        id: repositoryId,
        identity: "https://example.com/original.git",
        name: "original",
        rootPath: process.cwd(),
      })
      .run();
    drizzleDb.insert(spaceRepositories).values({ spaceId, repositoryId }).run();

    const response = await action(spaceId, {
      action: "updateRepository",
      repoId: repositoryId,
      name: "should-not-attach",
      path: alternateRepositoryPath,
    });

    expect(response?.status).toBe(409);
    expect(drizzleDb.select().from(spaceRepositories).all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ spaceId, repositoryId })]),
    );
    expect(
      drizzleDb
        .select()
        .from(repositories)
        .all()
        .some((repository) => repository.identity === "https://example.com/alternate.git"),
    ).toBe(false);
  });

  it("rejects worktree claims when the repository is not attached to the space", async () => {
    const spaceId = "test-space-unscoped-worktree";
    const repositoryId = "test-repository-unscoped";
    const worktreeId = "test-worktree-unscoped";
    drizzleDb.insert(spaces).values({ id: spaceId, name: "Unscoped worktree" }).run();
    drizzleDb
      .insert(repositories)
      .values({
        id: repositoryId,
        identity: "https://example.com/unscoped.git",
        name: "unscoped",
        rootPath: alternateRepositoryPath,
      })
      .run();
    drizzleDb
      .insert(worktrees)
      .values({
        id: worktreeId,
        path: path.join(alternateRepositoryPath, "worktree"),
        repositoryId,
        branch: "feature/unscoped",
        isMain: 0,
      })
      .run();

    const response = await action(spaceId, {
      action: "claimWorktree",
      repoId: repositoryId,
      worktree: "unscoped",
    });

    expect(response?.status).toBe(409);
    expect(drizzleDb.select().from(spaceWorktrees).all()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ spaceId, worktreeId })]),
    );
  });

  it("attaches a repository without importing its non-main worktrees", async () => {
    const spaceId = "test-space-repository-without-worktrees";
    drizzleDb.insert(spaces).values({ id: spaceId, name: "Repository only" }).run();

    const response = await action(spaceId, {
      action: "attachRepository",
      name: "alternate",
      path: alternateRepositoryPath,
    });

    expect(response?.status).toBe(200);
    const repository = drizzleDb
      .select()
      .from(repositories)
      .all()
      .find((candidate) => candidate.identity === "https://example.com/alternate.git");
    expect(repository).toBeDefined();
    const repositoryWorktrees = drizzleDb
      .select()
      .from(worktrees)
      .all()
      .filter((worktree) => worktree.repositoryId === repository?.id);
    expect(repositoryWorktrees.filter((worktree) => !worktree.isMain)).toEqual([]);
    expect(repositoryWorktrees.filter((worktree) => worktree.isMain)).toHaveLength(1);
    expect(drizzleDb.select().from(spaceWorktrees).all()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ spaceId })]),
    );

    const discoverResponse = await action(spaceId, {
      action: "discoverWorktrees",
      repoId: repository!.id,
    });
    expect(discoverResponse?.status).toBe(200);
    const discoveredWorktrees = drizzleDb
      .select()
      .from(worktrees)
      .all()
      .filter((worktree) => worktree.repositoryId === repository?.id);
    expect(discoveredWorktrees.map((worktree) => worktree.path)).toEqual(
      expect.arrayContaining([realpathSync(featureWorktreePath)]),
    );
    expect(drizzleDb.select().from(spaceWorktrees).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spaceId,
          worktreeId: discoveredWorktrees.find(
            (worktree) => worktree.path === realpathSync(featureWorktreePath),
          )?.id,
        }),
      ]),
    );

    const worktreeResponse = await action(spaceId, {
      action: "attachRepository",
      name: "demo-project",
      path: featureWorktreePath,
    });
    expect(worktreeResponse?.status).toBe(200);
    expect(
      drizzleDb.select().from(repositories).where(eq(repositories.id, repository!.id)).get()?.name,
    ).toBe("alternate");
    const importedWorktrees = drizzleDb
      .select()
      .from(worktrees)
      .all()
      .filter((worktree) => worktree.repositoryId === repository?.id);
    expect(importedWorktrees.map((worktree) => worktree.path)).toEqual(
      expect.arrayContaining([
        realpathSync(alternateRepositoryPath),
        realpathSync(featureWorktreePath),
      ]),
    );
    expect(drizzleDb.select().from(spaceWorktrees).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spaceId,
          worktreeId: importedWorktrees.find(
            (worktree) => worktree.path === realpathSync(featureWorktreePath),
          )?.id,
        }),
      ]),
    );

    const releaseResponse = await action(spaceId, {
      action: "releaseWorktree",
      repoId: repository!.id,
      worktree: "feature/hidden",
    });
    expect(releaseResponse?.status).toBe(200);
    expect(drizzleDb.select().from(spaceWorktrees).all()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          spaceId,
          worktreeId: importedWorktrees.find(
            (worktree) => worktree.path === realpathSync(featureWorktreePath),
          )?.id,
        }),
      ]),
    );

    const detachResponse = await action(spaceId, {
      action: "releaseRepository",
      repoId: repository!.id,
    });
    expect(detachResponse?.status).toBe(200);
    const reattachResponse = await action(spaceId, {
      action: "attachRepository",
      name: "alternate",
      path: alternateRepositoryPath,
    });
    expect(reattachResponse?.status).toBe(200);
    const reattachedBody = (await reattachResponse!.json()) as {
      state: { spaces: Array<{ id: string; repos: Array<Record<string, unknown>> }> };
    };
    const reattachedRepo = reattachedBody.state.spaces
      .find((space) => space.id === spaceId)
      ?.repos.find((repo) => repo.id === repository!.id);
    expect(reattachedRepo).toMatchObject({ worktrees: [], availableWorktrees: [] });
  });

  it("allows ownership-only claim for a session without a cwd", async () => {
    const spaceId = "test-space-session-without-cwd";
    const sessionId = "test-session-without-cwd";
    drizzleDb.insert(spaces).values({ id: spaceId, name: "No cwd" }).run();
    drizzleDb.insert(sessions).values({ id: sessionId, cwd: null }).run();

    const response = await action(spaceId, { action: "claimSession", sessionId });

    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      placement: { repositoryId: string | null; worktreeId: string | null };
    };
    expect(body.placement).toMatchObject({
      repositoryId: null,
      worktreeId: null,
      attachedRepository: false,
      attachedWorktree: false,
    });
    expect(
      drizzleDb.select().from(spaceSessions).where(eq(spaceSessions.sessionId, sessionId)).get(),
    ).toMatchObject({ spaceId, sessionId });
  });

  it("enriches attached sessions with real roster fields from messages and cache", async () => {
    const { messages } = await import("../db/drizzle-schema.ts");
    const { opencodeStatusCache, opencodeSessionInfoCache } = await import("../opencode/cache.ts");
    const spaceId = "test-space-roster-enrich";
    const sessionId = "ses_71319e2ec797GSTHxddSczc5KC";
    drizzleDb.insert(spaces).values({ id: spaceId, name: "Roster" }).run();
    drizzleDb
      .insert(sessions)
      .values({
        id: sessionId,
        alias: "Roster E2E",
        cwd: "/tmp/roster-workspace",
        opencodeSelectedModelProvider: "openai",
        opencodeSelectedModel: "gpt-4.1-mini",
      })
      .run();
    drizzleDb.insert(spaceSessions).values({ sessionId, spaceId }).run();
    drizzleDb
      .insert(messages)
      .values({
        sessionId,
        author: "agent",
        text: "Real Say message for roster",
        status: "spoken",
        opencodeDeliveryStatus: "sent",
      })
      .run();
    opencodeStatusCache.set(`dir\n${sessionId}`, { status: "idle", time: Date.now() });
    opencodeSessionInfoCache.set(sessionId, {
      title: "Cached title",
      directory: "/tmp/roster-workspace",
      agent: "build",
      modelProvider: "openai",
      model: "gpt-4.1-mini",
      time: Date.now(),
    });

    const response = await dispatchEffectApiRequest(new Request("http://say.local/api/spaces"));
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      state: {
        spaces: Array<{
          id: string;
          sessions: Array<Record<string, unknown>>;
        }>;
      };
    };
    const session = body.state.spaces
      .find((space) => space.id === spaceId)
      ?.sessions.find((item) => item.id === sessionId);
    expect(session).toMatchObject({
      id: sessionId,
      title: expect.stringMatching(/Roster|Cached/),
      provider: "OpenCode",
      model: "gpt-4.1-mini",
      rosterStatus: "idle",
      rosterStatusLabel: "IDLE",
      workspacePath: "/tmp/roster-workspace",
      workspaceLabel: "roster-workspace",
      latestSayMessage: "Real Say message for roster",
      latestSayAuthor: "agent",
      cachedOpenCodeStatus: "idle",
    });
    expect(session?.latestActivityText).toBe("Real Say message for roster");
    expect(session?.activityAt).toBeTruthy();
    expect(session?.importedAt).toBeTruthy();
  });

  it("does not let an internal idle notice replace a prior agent reply on the roster", async () => {
    const { messages } = await import("../db/drizzle-schema.ts");
    const spaceId = "test-space-roster-idle-skip";
    const sessionId = "ses_c7dce39dfb1doy4J9bBTFKnaQo";
    drizzleDb.insert(spaces).values({ id: spaceId, name: "Idle skip" }).run();
    drizzleDb
      .insert(sessions)
      .values({
        id: sessionId,
        alias: "Idle skip",
        cwd: "/tmp/roster-idle-skip",
      })
      .run();
    drizzleDb.insert(spaceSessions).values({ sessionId, spaceId }).run();
    drizzleDb
      .insert(messages)
      .values({
        sessionId,
        author: "agent",
        text: "ROSTER-LIVE-2026",
        status: "spoken",
        opencodeDeliveryStatus: "sent",
      })
      .run();
    drizzleDb
      .insert(messages)
      .values({
        sessionId,
        author: "user",
        text: `<say-to-me-system>${sessionId} is idle now</say-to-me-system>`,
        status: "spoken",
        opencodeDeliveryStatus: "ui_only",
      })
      .run();

    const response = await dispatchEffectApiRequest(new Request("http://say.local/api/spaces"));
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      state: {
        spaces: Array<{
          id: string;
          sessions: Array<Record<string, unknown>>;
        }>;
      };
    };
    const session = body.state.spaces
      .find((space) => space.id === spaceId)
      ?.sessions.find((item) => item.id === sessionId);
    expect(session).toMatchObject({
      latestSayMessage: "ROSTER-LIVE-2026",
      latestSayAuthor: "agent",
      latestDeliveryStatus: "sent",
      latestActivityText: "ROSTER-LIVE-2026",
    });
    expect(session?.latestSayMessage).not.toMatch(/is idle now/);
  });

  it("claims a session from an unclaimed feature worktree and attaches it", async () => {
    const spaceId = "test-space-unclaimed-session-worktree";
    const sessionId = "test-session-unclaimed-worktree";
    drizzleDb.insert(spaces).values({ id: spaceId, name: "Session visibility" }).run();
    const repository = drizzleDb
      .select()
      .from(repositories)
      .all()
      .find((candidate) => candidate.identity === "https://example.com/alternate.git");
    expect(repository).toBeDefined();
    drizzleDb.insert(spaceRepositories).values({ spaceId, repositoryId: repository!.id }).run();
    drizzleDb.insert(sessions).values({ id: sessionId, cwd: featureWorktreePath }).run();

    const response = await action(spaceId, { action: "claimSession", sessionId });

    expect(response?.status).toBe(200);
    const featureWorktree = drizzleDb
      .select()
      .from(worktrees)
      .all()
      .find((worktree) => worktree.path === realpathSync(featureWorktreePath));
    expect(featureWorktree).toBeDefined();
    expect(drizzleDb.select().from(spaceWorktrees).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ spaceId, worktreeId: featureWorktree!.id }),
      ]),
    );
    expect(
      drizzleDb.select().from(spaceSessions).where(eq(spaceSessions.sessionId, sessionId)).get(),
    ).toMatchObject({ spaceId, sessionId });
  });

  it("moves a session with its repository and exact worktree into the destination space", async () => {
    const sourceSpaceId = "test-space-session-move-source";
    const targetSpaceId = "test-space-session-move-target";
    const sessionId = "test-session-move-worktree";
    drizzleDb
      .insert(spaces)
      .values([
        { id: sourceSpaceId, name: "Session source" },
        { id: targetSpaceId, name: "Session target" },
      ])
      .run();

    const attachResponse = await action(sourceSpaceId, {
      action: "attachRepository",
      name: "alternate",
      path: featureWorktreePath,
    });
    expect(attachResponse?.status).toBe(200);
    const repository = drizzleDb
      .select()
      .from(repositories)
      .all()
      .find((candidate) => candidate.identity === "https://example.com/alternate.git");
    expect(repository).toBeDefined();
    const featureWorktree = drizzleDb
      .select()
      .from(worktrees)
      .all()
      .find((worktree) => worktree.path === realpathSync(featureWorktreePath));
    expect(featureWorktree).toBeDefined();
    drizzleDb.insert(sessions).values({ id: sessionId, cwd: featureWorktreePath }).run();
    drizzleDb.insert(spaceSessions).values({ sessionId, spaceId: sourceSpaceId }).run();

    const response = await action(targetSpaceId, { action: "moveSession", sessionId });

    expect(response?.status).toBe(200);
    expect(
      drizzleDb
        .select()
        .from(spaceRepositories)
        .all()
        .find(
          ({ spaceId, repositoryId }) =>
            spaceId === targetSpaceId && repositoryId === repository!.id,
        ),
    ).toBeDefined();
    expect(drizzleDb.select().from(spaceWorktrees).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ spaceId: targetSpaceId, worktreeId: featureWorktree!.id }),
      ]),
    );
    expect(
      drizzleDb.select().from(spaceSessions).where(eq(spaceSessions.sessionId, sessionId)).get(),
    ).toMatchObject({
      sessionId,
      spaceId: targetSpaceId,
    });
  });

  it("placeSession claims subdirectory cwd via git toplevel and returns worktreeId", async () => {
    const spaceId = "test-space-subdir-claim";
    const sessionId = "test-session-subdir";
    const subdir = path.join(alternateRepositoryPath, "packages", "app");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(subdir, { recursive: true });
    drizzleDb.insert(spaces).values({ id: spaceId, name: "Subdir" }).run();
    drizzleDb.insert(sessions).values({ id: sessionId, cwd: subdir }).run();

    const response = await action(spaceId, {
      action: "placeSession",
      sessionId,
      mode: "claim",
    });
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      placement: {
        worktreeId: string | null;
        repositoryId: string | null;
        isMainCheckout: boolean | null;
        canonicalDashboardPath: string;
        attachedRepository: boolean;
      };
    };
    expect(body.placement.isMainCheckout).toBe(true);
    expect(body.placement.worktreeId).toBeTruthy();
    expect(body.placement.repositoryId).toBeTruthy();
    expect(body.placement.attachedRepository).toBe(true);
    expect(body.placement.canonicalDashboardPath).toContain("worktreeId=");
    expect(
      drizzleDb
        .select()
        .from(spaceWorktrees)
        .all()
        .filter((row) => row.spaceId === spaceId),
    ).toEqual([]);
  });

  it("placeSession move rejects stale expected owner without mutating target attachments", async () => {
    const sourceSpaceId = "test-space-stale-source";
    const targetSpaceId = "test-space-stale-target";
    const otherSpaceId = "test-space-stale-other";
    const sessionId = "test-session-stale-owner";
    drizzleDb
      .insert(spaces)
      .values([
        { id: sourceSpaceId, name: "Source" },
        { id: targetSpaceId, name: "Target" },
        { id: otherSpaceId, name: "Other" },
      ])
      .run();
    drizzleDb.insert(sessions).values({ id: sessionId, cwd: alternateRepositoryPath }).run();
    drizzleDb.insert(spaceSessions).values({ sessionId, spaceId: otherSpaceId }).run();

    const beforeRepos = drizzleDb.select().from(spaceRepositories).all();
    const beforeWorktrees = drizzleDb.select().from(spaceWorktrees).all();
    const beforeSessions = drizzleDb.select().from(spaceSessions).all();

    const response = await action(targetSpaceId, {
      action: "placeSession",
      sessionId,
      mode: "move",
      expectedOwnerSpaceId: sourceSpaceId,
    });
    expect(response?.status).toBe(409);
    expect(drizzleDb.select().from(spaceRepositories).all()).toEqual(beforeRepos);
    expect(drizzleDb.select().from(spaceWorktrees).all()).toEqual(beforeWorktrees);
    expect(drizzleDb.select().from(spaceSessions).all()).toEqual(beforeSessions);
  });

  it("dashboard-placement GET is non-mutating and reports unowned chooser", async () => {
    const spaceId = "test-space-placement-resolver";
    const sessionId = "test-session-placement-resolver";
    drizzleDb.insert(spaces).values({ id: spaceId, name: "Resolver" }).run();
    drizzleDb.insert(sessions).values({ id: sessionId, cwd: alternateRepositoryPath }).run();

    const beforeRepos = drizzleDb.select().from(repositories).all();
    const beforeWorktrees = drizzleDb.select().from(worktrees).all();
    const beforeSpaceRepos = drizzleDb.select().from(spaceRepositories).all();

    const response = await dispatchEffectApiRequest(
      new Request(
        `http://say.local/api/sessions/${sessionId}/dashboard-placement?targetSpaceId=${spaceId}`,
      ),
    );
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      needsChooser: boolean;
      chooserMode: string;
      worktreeId: string | null;
      preview: { wouldAttachRepository: boolean; warnings: string[] };
    };
    expect(body.needsChooser).toBe(true);
    expect(body.chooserMode).toBe("claim");
    // May already have a synced worktree row from earlier tests; resolver must not create new ones.
    expect(
      body.preview.warnings.length + (body.preview.wouldAttachRepository ? 1 : 0),
    ).toBeGreaterThan(0);
    expect(drizzleDb.select().from(repositories).all()).toEqual(beforeRepos);
    expect(drizzleDb.select().from(worktrees).all()).toEqual(beforeWorktrees);
    expect(drizzleDb.select().from(spaceRepositories).all()).toEqual(beforeSpaceRepos);
  });

  it("dashboard-placement GET returns 404 for a missing session", async () => {
    const response = await dispatchEffectApiRequest(
      new Request("http://say.local/api/sessions/missing-session-placement/dashboard-placement"),
    );
    expect(response?.status).toBe(404);
    expect(await response!.json()).toEqual({ error: "Session not found." });
  });

  it("returns persisted space activity for currently attached sessions", async () => {
    const { messages } = await import("../db/drizzle-schema.ts");
    const spaceId = "test-space-activity-api";
    const sessionId = "ses_e7a037b3199dqQrgrEYVBvrje5";
    drizzleDb.insert(spaces).values({ id: spaceId, name: "Activity API" }).run();
    drizzleDb.insert(sessions).values({ id: sessionId, alias: "API session" }).run();
    await action(spaceId, { action: "claimSession", sessionId });
    drizzleDb
      .insert(messages)
      .values({
        sessionId,
        text: "ROSTER-LIVE-2026",
        author: "agent",
        status: "done",
      })
      .run();

    const response = await dispatchEffectApiRequest(
      new Request(`http://say.local/api/spaces/${spaceId}/activity`),
    );
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      spaceId: string;
      spaceName: string;
      events: Array<{ type: string; detail: string }>;
      timerFreshnessNote: string;
      retention: {
        scopeNote: string;
        maxRangeHours: number;
        appliedRangeHours: number;
        notificationRetentionLimit: number;
      };
    };
    expect(body.spaceId).toBe(spaceId);
    expect(body.spaceName).toBe("Activity API");
    expect(body.timerFreshnessNote).toContain("jarvis_timers");
    expect(body.retention.scopeNote).toContain("currently attached");
    expect(body.retention.maxRangeHours).toBe(720);
    expect(body.events.some((event) => event.detail.includes("ROSTER-LIVE-2026"))).toBe(true);
    expect(body.events.some((event) => event.type === "attachment")).toBe(true);
  });

  it("reorderSiblings persists top-level sortOrder and returns spaces in that order", async () => {
    const parent = "test-space-reorder-parent";
    const alpha = "test-space-reorder-alpha";
    const beta = "test-space-reorder-beta";
    const gamma = "test-space-reorder-gamma";
    drizzleDb.insert(spaces).values({ id: parent, name: "Parent", sortOrder: 0 }).run();
    drizzleDb
      .insert(spaces)
      .values([
        { id: alpha, name: "Alpha", parentId: parent, sortOrder: 0 },
        { id: beta, name: "Beta", parentId: parent, sortOrder: 1 },
        { id: gamma, name: "Gamma", parentId: parent, sortOrder: 2 },
      ])
      .run();

    const response = await action(alpha, {
      action: "reorderSiblings",
      orderedIds: [gamma, alpha, beta],
    });
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      state: { spaces: Array<{ id: string; parentId: string | null; sortOrder?: number }> };
    };
    const children = body.state.spaces.filter((space) => space.parentId === parent);
    expect(children.map((space) => space.id)).toEqual([gamma, alpha, beta]);
    expect(
      drizzleDb
        .select()
        .from(spaces)
        .all()
        .filter((space) => space.parentId === parent)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((space) => space.id),
    ).toEqual([gamma, alpha, beta]);
  });

  it("rejects a stale reorderSiblings list without mutating sortOrder", async () => {
    const parent = "test-space-reorder-stale-parent";
    const alpha = "test-space-reorder-stale-alpha";
    const beta = "test-space-reorder-stale-beta";
    const gamma = "test-space-reorder-stale-gamma";
    drizzleDb.insert(spaces).values({ id: parent, name: "Stale Parent", sortOrder: 0 }).run();
    drizzleDb
      .insert(spaces)
      .values([
        { id: alpha, name: "Alpha", parentId: parent, sortOrder: 0 },
        { id: beta, name: "Beta", parentId: parent, sortOrder: 1 },
        { id: gamma, name: "Gamma", parentId: parent, sortOrder: 2 },
      ])
      .run();

    const response = await action(alpha, {
      action: "reorderSiblings",
      // Concurrent tab holding a stale sibling list (missing gamma).
      orderedIds: [beta, alpha],
    });
    expect(response?.status).toBe(400);
    expect(
      drizzleDb
        .select()
        .from(spaces)
        .all()
        .filter((space) => space.parentId === parent)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((space) => ({ id: space.id, sortOrder: space.sortOrder })),
    ).toEqual([
      { id: alpha, sortOrder: 0 },
      { id: beta, sortOrder: 1 },
      { id: gamma, sortOrder: 2 },
    ]);
  });

  it("move into a populated sibling group appends at max+1 without collisions", async () => {
    const dest = "test-space-reparent-dest";
    const other = "test-space-reparent-other";
    const moving = "test-space-reparent-moving";
    drizzleDb
      .insert(spaces)
      .values([
        { id: dest, name: "Dest", sortOrder: 0 },
        { id: other, name: "Other under dest", parentId: dest, sortOrder: 0 },
        { id: moving, name: "Moving", sortOrder: 0 },
      ])
      .run();

    const response = await action(moving, { action: "move", parentId: dest });
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      state: { spaces: Array<{ id: string; parentId: string | null; sortOrder?: number }> };
    };
    const moved = body.state.spaces.find((space) => space.id === moving);
    expect(moved).toMatchObject({ parentId: dest, sortOrder: 1 });
    const underDest = drizzleDb
      .select()
      .from(spaces)
      .all()
      .filter((space) => space.parentId === dest)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    expect(underDest.map((space) => ({ id: space.id, sortOrder: space.sortOrder }))).toEqual([
      { id: other, sortOrder: 0 },
      { id: moving, sortOrder: 1 },
    ]);
  });

  it("update parent into a populated group appends at max+1 and broadcasts", async () => {
    const { broadcastDebounceMs } = await import("../config.ts");
    const { registerSessionListSseClient, unregisterSessionListSseClient } =
      await import("../broadcast.ts");
    const dest = "test-space-update-parent-dest";
    const sibling = "test-space-update-parent-sibling";
    const moving = "test-space-update-parent-moving";
    drizzleDb
      .insert(spaces)
      .values([
        { id: dest, name: "Update Dest", sortOrder: 0 },
        { id: sibling, name: "Sibling", parentId: dest, sortOrder: 0 },
        { id: moving, name: "Update Moving", sortOrder: 5 },
      ])
      .run();

    let writes = 0;
    const client = {
      close() {},
      write: async () => {
        writes += 1;
      },
    };
    registerSessionListSseClient(client, {
      includeCachedStatus: false,
      includeJarvisOverviewDetails: false,
    });
    try {
      const response = await action(moving, {
        action: "update",
        name: "Update Moving",
        context: "",
        parentId: dest,
      });
      expect(response?.status).toBe(200);
      const body = (await response!.json()) as {
        state: { spaces: Array<{ id: string; parentId: string | null; sortOrder?: number }> };
      };
      expect(body.state.spaces.find((space) => space.id === moving)).toMatchObject({
        parentId: dest,
        sortOrder: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, broadcastDebounceMs + 40));
      expect(writes).toBeGreaterThan(0);
    } finally {
      unregisterSessionListSseClient(client);
    }
  });

  it("selectedSpaceId and flat spaces follow canonical Organize DFS order", async () => {
    const rootB = "test-space-canonical-root-b";
    const rootA = "test-space-canonical-root-a";
    const childA = "test-space-canonical-child-a";
    // Wipe defaults so selectedSpaceId is driven only by this tree.
    for (const row of drizzleDb.select().from(spaces).all()) {
      drizzleDb.delete(spaces).where(eq(spaces.id, row.id)).run();
    }
    drizzleDb
      .insert(spaces)
      .values([
        { id: rootB, name: "Root B", sortOrder: 1 },
        { id: rootA, name: "Root A", sortOrder: 0 },
        { id: childA, name: "Child A", parentId: rootA, sortOrder: 0 },
      ])
      .run();

    const response = await dispatchEffectApiRequest(new Request("http://say.local/api/spaces"));
    expect(response?.status).toBe(200);
    const body = (await response!.json()) as {
      state: {
        selectedSpaceId: string;
        spaces: Array<{ id: string }>;
      };
    };
    // Child sortOrder=0 must not become the default ahead of Root A.
    expect(body.state.selectedSpaceId).toBe(rootA);
    expect(body.state.spaces.map((space) => space.id)).toEqual([rootA, childA, rootB]);

    await action(rootA, {
      action: "reorderSiblings",
      orderedIds: [rootB, rootA],
    });
    const after = await dispatchEffectApiRequest(new Request("http://say.local/api/spaces"));
    const afterBody = (await after!.json()) as {
      state: { selectedSpaceId: string; spaces: Array<{ id: string }> };
    };
    expect(afterBody.state.selectedSpaceId).toBe(rootB);
    expect(afterBody.state.spaces.map((space) => space.id)).toEqual([rootB, rootA, childA]);
  });
});
