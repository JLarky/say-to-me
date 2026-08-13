import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { and, eq } from "drizzle-orm";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-jarvis-create-test-"));
const jarvisParent = mkdtempSync(path.join(tmpdir(), "say-to-me-jarvis-parent-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { dispatchEffectApiRequest } = await import("./api-routes/effect-api.ts");
const { drizzleDb, drizzleSqlite } = await import("./db/index.ts");
const { jarvisCreateOperations, messages, spaceRepositories, spaceSessions } =
  await import("./db/drizzle-schema.ts");
const { mockOpenCode } = await import("./api.harness.ts");
const {
  createJarvisInSpace,
  jarvisCreateLeaseHeartbeatEffectForTest,
  jarvisOperationBindMarker,
  releaseJarvisCreateLease,
  resetJarvisCreateDepsForTest,
  setJarvisCreateDepsForTest,
  tryAcquireJarvisCreateLease,
} = await import("./jarvis-create.ts");
const { deleteSession, ensureSession, getSessionByAlias, setSessionAliasIfSafe } =
  await import("./sessions.ts");
const { materializeJarvisTemplate } = await import("./jarvis-template.ts");
const { createOpenCodeSession } = await import("./opencode/client.ts");

async function createSpace(name: string) {
  const response = await dispatchEffectApiRequest(
    new Request("http://say.local/api/spaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, context: "", parentId: null }),
    }),
  );
  const body = await response!.json();
  return body.spaceId as string;
}

async function patchJarvisParent(parent: string) {
  return dispatchEffectApiRequest(
    new Request("http://say.local/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferredJarvisParentPath: parent }),
    }),
  );
}

function installOpenCodeModelDeps(extra: Parameters<typeof setJarvisCreateDepsForTest>[0] = {}) {
  setJarvisCreateDepsForTest({
    listOpenCodeModels: async () => [
      {
        providerID: "openai",
        id: "gpt-4.1-mini",
        name: "gpt-4.1-mini",
        reasoningEfforts: [],
      },
    ],
    setOpenCodeSessionModel: async () => undefined,
    ...extra,
  });
}

function clearJarvisCreateDeps(extra: Parameters<typeof setJarvisCreateDepsForTest>[0] = {}) {
  resetJarvisCreateDepsForTest();
  installOpenCodeModelDeps(extra);
}

async function createJarvis(
  spaceId: string,
  name: string,
  provider = "opencode",
  modelID = "openai/gpt-4.1-mini",
) {
  return dispatchEffectApiRequest(
    new Request(`http://say.local/api/spaces/${spaceId}/jarvis`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        provider,
        ...(provider === "opencode" || modelID ? { modelID } : {}),
      }),
    }),
  );
}

function seedExistingJarvisRepo(directory: string, userFileContents: string) {
  mkdirSync(directory, { recursive: true });
  materializeJarvisTemplate(directory);
  writeFileSync(path.join(directory, "user-notes.md"), userFileContents);
  execFileSync("git", ["-C", directory, "init", "-q", "-b", "main"]);
  execFileSync("git", ["-C", directory, "add", "-A"], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "User",
      GIT_AUTHOR_EMAIL: "user@example.com",
      GIT_COMMITTER_NAME: "User",
      GIT_COMMITTER_EMAIL: "user@example.com",
    },
  });
  execFileSync("git", ["-C", directory, "commit", "-q", "-m", "user seed"], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "User",
      GIT_AUTHOR_EMAIL: "user@example.com",
      GIT_COMMITTER_NAME: "User",
      GIT_COMMITTER_EMAIL: "user@example.com",
    },
  });
}

describe("POST /api/spaces/:spaceId/jarvis", () => {
  let spaceId = "";
  let openCode: Awaited<ReturnType<typeof mockOpenCode>>;
  let previousOpenCodeUrl: string | undefined;
  let sessionCounter = 0;
  const openCodeSessionsByDirectory = new Map<string, Array<{ id: string; title: string }>>();

  beforeAll(async () => {
    previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({}));
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/session")) {
        const url = new URL(req.url, "http://opencode.test");
        const directory = url.searchParams.get("directory") || "";
        const list = openCodeSessionsByDirectory.get(directory) ?? [];
        res.end(
          JSON.stringify(
            list.map((session) => ({
              id: session.id,
              title: session.title,
              directory,
              time: { created: 1, updated: 2 },
            })),
          ),
        );
        return;
      }
      if (req.method === "PATCH" && req.url?.startsWith("/session/")) {
        const id = req.url.split("/")[2]!;
        for (const [, list] of openCodeSessionsByDirectory) {
          const match = list.find((session) => session.id === id);
          if (match) match.title = match.title.startsWith("jarvis-op:") ? match.title : id;
        }
        // Title is also applied locally via bind marker alias; list uses stored titles when set.
        res.end(JSON.stringify({ id, title: "named", directory: jarvisParent }));
        return;
      }
      if (req.method === "POST" && req.url?.includes("/message")) {
        res.end(JSON.stringify({ info: { id: "msg_boot" }, parts: [] }));
        return;
      }
      if (req.method === "POST" && req.url?.startsWith("/session")) {
        sessionCounter += 1;
        const url = new URL(req.url, "http://opencode.test");
        const directory = url.searchParams.get("directory") || "";
        // Keep production OpenCode shape (12 hex + 14 base62); encode counter in suffix.
        const suffix = sessionCounter.toString(36).padStart(14, "0").slice(-14);
        const id = `ses_81155daadbf0${suffix}`;
        const list = openCodeSessionsByDirectory.get(directory) ?? [];
        list.push({ id, title: "New session" });
        openCodeSessionsByDirectory.set(directory, list);
        res.end(
          JSON.stringify({
            id,
            title: "New session",
            directory,
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      res.end(JSON.stringify({}));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;
    await patchJarvisParent(jarvisParent);
    spaceId = await createSpace("Jarvis home");
  });

  beforeEach(() => {
    installOpenCodeModelDeps();
  });

  afterEach(() => {
    resetJarvisCreateDepsForTest();
  });

  afterAll(() => {
    process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
    openCode.server.close();
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
    rmSync(jarvisParent, { force: true, recursive: true });
  });

  it("creates a git repo, attaches it, and marks the session jarvis", async () => {
    const response = await createJarvis(spaceId, "the jarvis");
    expect(response?.status).toBe(201);
    const body = await response!.json();
    expect(body.workspaceDirectory).toBe(path.join(jarvisParent, "the-jarvis"));
    expect(existsSync(path.join(body.workspaceDirectory, ".git"))).toBe(true);
    expect(existsSync(path.join(body.workspaceDirectory, "AGENTS.md"))).toBe(true);
    expect(body.session.state).toBe("jarvis");
    expect(body.bootstrapStatus).toMatch(/delivered|queued|failed/);
    expect(body.state.spaces.some((space: { id: string }) => space.id === spaceId)).toBe(true);

    const ownership = drizzleDb
      .select()
      .from(spaceSessions)
      .where(eq(spaceSessions.sessionId, body.session.id))
      .get();
    expect(ownership?.spaceId).toBe(spaceId);

    const repos = drizzleDb
      .select()
      .from(spaceRepositories)
      .where(eq(spaceRepositories.spaceId, spaceId))
      .all();
    expect(repos.length).toBeGreaterThan(0);
  });

  it("leaves a brand-new Jarvis repo clean after recording sessions.md", async () => {
    const created = await createJarvisInSpace({
      spaceId,
      name: "clean git",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    });
    const status = execFileSync(
      "git",
      ["-C", created.workspaceDirectory, "status", "--porcelain"],
      {
        encoding: "utf8",
      },
    ).trim();
    expect(status).toBe("");
    expect(existsSync(path.join(created.workspaceDirectory, "sessions.md"))).toBe(true);
    const card = created.state.spaces
      .find((space) => space.id === spaceId)
      ?.sessions.find((session) => session.id === created.session.id);
    expect(card).toMatchObject({
      agent: "Jarvis",
      provider: "OpenCode",
      status: "Jarvis",
    });
  });

  it("resumes the same session when the response is retried", async () => {
    const first = await createJarvis(spaceId, "retry me");
    const firstBody = await first!.json();
    const before = sessionCounter;
    const second = await createJarvis(spaceId, "retry me");
    const secondBody = await second!.json();
    expect(second?.status).toBe(201);
    expect(secondBody.session.id).toBe(firstBody.session.id);
    expect(secondBody.resumed).toBe(true);
    expect(sessionCounter).toBe(before);
  });

  it("serializes concurrent identical POSTs onto one session", async () => {
    const [a, b] = await Promise.all([
      createJarvis(spaceId, "concurrent jarvis"),
      createJarvis(spaceId, "concurrent jarvis"),
    ]);
    const bodyA = await a!.json();
    const bodyB = await b!.json();
    expect(a?.status).toBe(201);
    expect(b?.status).toBe(201);
    expect(bodyA.session.id).toBe(bodyB.session.id);
    const ops = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .all()
      .filter((op) => op.slug === "concurrent-jarvis");
    expect(ops).toHaveLength(1);
  });

  it("rejects a different provider fingerprint for an existing operation", async () => {
    await createJarvis(spaceId, "fingerprint lock");
    const response = await dispatchEffectApiRequest(
      new Request(`http://say.local/api/spaces/${spaceId}/jarvis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "fingerprint lock", provider: "claude", modelID: "opus" }),
      }),
    );
    expect(response?.status).toBe(409);
    const body = await response!.json();
    expect(body.error).toMatch(/different provider/i);
  });

  it("rejects invalid reasoningEffort at the spaces route schema boundary", async () => {
    const response = await dispatchEffectApiRequest(
      new Request(`http://say.local/api/spaces/${spaceId}/jarvis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "bad effort spaces",
          provider: "codex",
          modelID: "gpt-5",
          reasoningEffort: "not-a-real-effort",
        }),
      }),
    );
    expect(response?.status).toBe(400);
  });

  it("rejects invalid reasoningEffort at the deprecated jarvis-sessions schema boundary", async () => {
    const response = await dispatchEffectApiRequest(
      new Request("http://say.local/api/jarvis-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "bad effort jarvis-sessions",
          spaceId,
          provider: "codex",
          modelID: "gpt-5",
          reasoningEffort: "not-a-real-effort",
        }),
      }),
    );
    expect(response?.status).toBe(400);
  });

  it("never deletes an existing Jarvis repo with user files when create fails", async () => {
    const workspace = path.join(jarvisParent, "user-repo");
    seedExistingJarvisRepo(workspace, "keep me");
    writeFileSync(path.join(workspace, "extra-work.txt"), "uncommitted");

    installOpenCodeModelDeps({
      createOpenCodeSession: async () => ({
        ok: false,
        status: 502,
        error: "injected provider failure",
      }),
    });

    const response = await createJarvis(spaceId, "user repo");
    expect(response?.status).toBe(502);
    expect(existsSync(workspace)).toBe(true);
    expect(readFileSync(path.join(workspace, "user-notes.md"), "utf8")).toBe("keep me");
    expect(existsSync(path.join(workspace, "extra-work.txt"))).toBe(true);
  });

  it("does not delete a pre-existing empty directory on failure", async () => {
    const workspace = path.join(jarvisParent, "empty-owned");
    mkdirSync(workspace, { recursive: true });
    installOpenCodeModelDeps({
      createOpenCodeSession: async () => ({
        ok: false,
        status: 502,
        error: "fail after stage",
      }),
    });
    const response = await createJarvis(spaceId, "empty owned");
    expect(response?.status).toBe(502);
    expect(existsSync(workspace)).toBe(true);
  });

  it("rejects a second space claiming the same physical workspace path", async () => {
    const otherSpace = await createSpace("Other home");
    await createJarvis(spaceId, "shared path");
    const response = await createJarvis(otherSpace, "shared path");
    expect(response?.status).toBe(409);
    const body = await response!.json();
    expect(body.error).toMatch(/another space/i);
  });

  it("uses a DB lease so a second process owner cannot steal an active operation", () => {
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.slug, "shared-path"))
      .get();
    expect(op).toBeTruthy();
    expect(tryAcquireJarvisCreateLease(op!.id, "process-a")).toBe(true);
    expect(tryAcquireJarvisCreateLease(op!.id, "process-b")).toBe(false);
    releaseJarvisCreateLease(op!.id, "process-a");
    expect(tryAcquireJarvisCreateLease(op!.id, "process-b")).toBe(true);
    releaseJarvisCreateLease(op!.id, "process-b");
  });

  it("fails when the lease is stolen during provider creation", async () => {
    installOpenCodeModelDeps({
      leaseTtlMs: 20,
      createOpenCodeSession: async (directory) => {
        const op = drizzleDb
          .select()
          .from(jarvisCreateOperations)
          .where(eq(jarvisCreateOperations.alias, "lease race"))
          .get();
        expect(op).toBeTruthy();
        drizzleSqlite
          .prepare(
            `UPDATE jarvis_create_operations SET lease_owner = ?, leased_at = ? WHERE id = ?`,
          )
          .run("thief-process", Date.now(), op!.id);
        return createOpenCodeSession(directory);
      },
    });
    const response = await createJarvis(spaceId, "lease race");
    expect(response?.status).toBe(409);
    const body = await response!.json();
    expect(body.error).toMatch(/lease/i);
  });

  it("maps a lease acquire SQLite throw to a typed JarvisCreateError response", async () => {
    installOpenCodeModelDeps({
      throwFromLeaseDb: "acquire",
    });
    const response = await createJarvis(spaceId, "acquire db boom");
    expect(response?.status).toBe(500);
    const body = await response!.json();
    expect(body.error).toMatch(/simulated lease acquire DB failure/i);
  });

  it("maps a renew SQLite throw in heartbeat to Fail (not Die) so catchAll stops cleanly", async () => {
    const { Cause, Effect, Exit } = await import("effect");
    installOpenCodeModelDeps({
      leaseTtlMs: 30,
      throwFromLeaseDb: "renew",
    });
    const exit = await Effect.runPromiseExit(
      jarvisCreateLeaseHeartbeatEffectForTest("op-renew-boundary", "owner-a"),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.isDie(exit.cause)).toBe(false);
    }
  });

  it("maps a lease heartbeat renew SQLite throw without defecting the create request", async () => {
    installOpenCodeModelDeps({
      leaseTtlMs: 60,
      throwFromLeaseDb: "heartbeat",
      createOpenCodeSession: async (directory) => {
        // Give the heartbeat fiber time to hit renew (period ≈ ttl/3).
        await new Promise((resolve) => setTimeout(resolve, 40));
        return createOpenCodeSession(directory);
      },
    });
    const response = await createJarvis(spaceId, "heartbeat db boom");
    // Heartbeat Fail is catchAll'd; create still completes with a typed success.
    expect(response?.status).toBe(201);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "heartbeat db boom"))
      .get();
    expect(op?.phase).toBe("completed");
  });

  it("maps a lease release SQLite throw to a typed JarvisCreateError after work", async () => {
    installOpenCodeModelDeps({
      throwFromLeaseDb: "release",
    });
    const response = await createJarvis(spaceId, "release db boom");
    expect(response?.status).toBe(500);
    const body = await response!.json();
    expect(body.error).toMatch(/simulated lease release DB failure/i);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "release db boom"))
      .get();
    // Work completed under the lease; release failed in the finalizer with a typed error.
    expect(op?.phase).toBe("completed");
    expect(op?.leaseOwner).toBeTruthy();
  });

  it("reconciles OpenCode sessions after a crash between create and persist", async () => {
    let crashOnce = true;
    let createdId = "";
    installOpenCodeModelDeps({
      crashAfterProviderCreateBeforePersist: (sessionId) => {
        createdId = sessionId;
        if (crashOnce) {
          crashOnce = false;
          throw new Error("simulated process crash after provider create");
        }
      },
    });

    const first = await createJarvis(spaceId, "crash window");
    expect(first?.status).toBe(500);
    expect(createdId).toMatch(/^ses_81155daadbf0[0-9a-z]{14}$/);
    expect(
      getSessionByAlias(
        jarvisOperationBindMarker(
          drizzleDb
            .select()
            .from(jarvisCreateOperations)
            .where(eq(jarvisCreateOperations.alias, "crash window"))
            .get()!.id,
        ),
      )?.id,
    ).toBe(createdId);

    clearJarvisCreateDeps();
    const before = sessionCounter;
    const second = await createJarvis(spaceId, "crash window");
    expect(second?.status).toBe(201);
    const body = await second!.json();
    expect(body.session.id).toBe(createdId);
    expect(sessionCounter).toBe(before);
  });

  it("does not hijack an unrelated same-directory OpenCode session on reconcile", async () => {
    const workspace = path.join(jarvisParent, "hijack-guard");
    mkdirSync(workspace, { recursive: true });
    materializeJarvisTemplate(workspace);
    execFileSync("git", ["-C", workspace, "init", "-q", "-b", "main"]);
    execFileSync("git", ["-C", workspace, "add", "-A"], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "User",
        GIT_AUTHOR_EMAIL: "user@example.com",
        GIT_COMMITTER_NAME: "User",
        GIT_COMMITTER_EMAIL: "user@example.com",
      },
    });
    execFileSync("git", ["-C", workspace, "commit", "-q", "-m", "seed"], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "User",
        GIT_AUTHOR_EMAIL: "user@example.com",
        GIT_COMMITTER_NAME: "User",
        GIT_COMMITTER_EMAIL: "user@example.com",
      },
    });

    const unrelatedId = "ses_b14e9a8d29c23D3c01uS3FkDoy";
    ensureSession(unrelatedId);
    setSessionAliasIfSafe(unrelatedId, "unrelated human alias");
    openCodeSessionsByDirectory.set(workspace, [
      { id: unrelatedId, title: "Someone else's session" },
    ]);

    let crashOnce = true;
    let createdId = "";
    installOpenCodeModelDeps({
      crashAfterProviderCreateBeforePersist: (sessionId) => {
        createdId = sessionId;
        if (crashOnce) {
          crashOnce = false;
          throw new Error("crash after marker");
        }
      },
    });

    await createJarvis(spaceId, "hijack guard");
    clearJarvisCreateDeps();
    const second = await createJarvis(spaceId, "hijack guard");
    expect(second?.status).toBe(201);
    const body = await second!.json();
    expect(body.session.id).toBe(createdId);
    expect(body.session.id).not.toBe(unrelatedId);
  });

  it("reconciles CLI sessions via bind marker after a crash before persist", async () => {
    let crashOnce = true;
    let createdId = "";
    installOpenCodeModelDeps({
      createCliSessionRecord: async (_provider, workspacePath, _model, _deps, _effort, options) => {
        const session = ensureSession(`gx_${crypto.randomUUID()}`);
        options?.crashAfterCreateBeforeMarker?.(session.id);
        if (options?.bindMarker) setSessionAliasIfSafe(session.id, options.bindMarker);
        const { setSessionCwd } = await import("./sessions.ts");
        return setSessionCwd(session.id, workspacePath);
      },
      crashAfterProviderCreateBeforePersist: (sessionId) => {
        createdId = sessionId;
        if (crashOnce) {
          crashOnce = false;
          throw new Error("cli crash before persist");
        }
      },
    });

    const first = await createJarvisInSpace({
      spaceId,
      name: "cli crash",
      provider: "grok",
      modelID: "grok-4.5",
    }).catch((error: Error) => error);
    expect(first).toBeInstanceOf(Error);
    expect(createdId).toMatch(/^gx_/);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "cli crash"))
      .get();
    expect(op?.sessionId).toBeNull();
    expect(getSessionByAlias(jarvisOperationBindMarker(op!.id))?.id).toBe(createdId);

    clearJarvisCreateDeps();
    installOpenCodeModelDeps({
      createCliSessionRecord: async () => {
        throw new Error("should not create another CLI session");
      },
    });
    const second = await createJarvisInSpace({
      spaceId,
      name: "cli crash",
      provider: "grok",
      modelID: "grok-4.5",
    });
    expect(second.session.id).toBe(createdId);
  });

  it("keeps bootstrap message identity stable across retries", async () => {
    const first = await createJarvis(spaceId, "bootstrap once");
    const firstBody = await first!.json();
    const sessionId = firstBody.session.id as string;
    const beforeCount = drizzleDb
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all().length;

    drizzleDb
      .update(jarvisCreateOperations)
      .set({ phase: "bootstrapping" })
      .where(eq(jarvisCreateOperations.sessionId, sessionId))
      .run();

    const second = await createJarvis(spaceId, "bootstrap once");
    expect(second?.status).toBe(201);
    const afterCount = drizzleDb
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all().length;
    expect(afterCount).toBe(beforeCount);
  });

  it("returns 409 when a nonempty non-Jarvis directory already exists", async () => {
    const conflict = path.join(jarvisParent, "occupied");
    mkdirSync(conflict, { recursive: true });
    writeFileSync(path.join(conflict, "notes.txt"), "not jarvis");
    const response = await createJarvis(spaceId, "occupied");
    expect(response?.status).toBe(409);
    const body = await response!.json();
    expect(body.error).toMatch(/already exists/i);
  });

  it("keeps deleted-session replay terminal across consecutive requests", async () => {
    const first = await createJarvis(spaceId, "deleted session");
    const firstBody = await first!.json();
    deleteSession(firstBody.session.id);
    const second = await createJarvis(spaceId, "deleted session");
    expect(second?.status).toBe(409);
    const secondBody = await second!.json();
    expect(secondBody.error).toMatch(/invalidated|deleted|different name/i);

    const third = await createJarvis(spaceId, "deleted session");
    expect(third?.status).toBe(409);
    const thirdBody = await third!.json();
    expect(thirdBody.error).toMatch(/invalidated|different name/i);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "deleted session"))
      .get();
    expect(op?.phase).toBe("invalidated");
  });

  it("resumes the persisted path when preferred parent settings change", async () => {
    const first = await createJarvisInSpace({
      spaceId,
      name: "parent lock",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    });
    const original = first.workspaceDirectory;
    const otherParent = mkdtempSync(path.join(tmpdir(), "say-to-me-jarvis-other-parent-"));
    await patchJarvisParent(otherParent);
    try {
      const second = await createJarvisInSpace({
        spaceId,
        name: "parent lock",
        provider: "opencode",
        modelID: "openai/gpt-4.1-mini",
      });
      expect(second.workspaceDirectory).toBe(original);
      expect(second.session.id).toBe(first.session.id);
      expect(existsSync(path.join(otherParent, "parent-lock"))).toBe(false);
    } finally {
      await patchJarvisParent(jarvisParent);
      rmSync(otherParent, { force: true, recursive: true });
    }
  });

  it("does not let a stale lease owner compensate after losing the lease", async () => {
    installOpenCodeModelDeps({
      leaseTtlMs: 40,
      createOpenCodeSession: async (directory, options) => {
        const op = drizzleDb
          .select()
          .from(jarvisCreateOperations)
          .where(eq(jarvisCreateOperations.alias, "stale lease"))
          .get();
        expect(op).toBeTruthy();
        // Successor process steals the lease while provider create is in flight.
        // Use an expired timestamp so a later successor request can acquire cleanly.
        drizzleSqlite
          .prepare(
            `UPDATE jarvis_create_operations SET lease_owner = ?, leased_at = ? WHERE id = ?`,
          )
          .run("successor-owner", Date.now() - 60_000, op!.id);
        return createOpenCodeSession(directory, options);
      },
    });

    const workspace = path.join(jarvisParent, "stale-lease");
    const stale = await createJarvisInSpace({
      spaceId,
      name: "stale lease",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    }).catch((error: Error) => error);
    expect(stale).toBeInstanceOf(Error);
    expect((stale as Error).message).toMatch(/lease/i);
    // Stale owner must not delete the staged workspace after losing ownership.
    expect(existsSync(workspace)).toBe(true);
    expect(existsSync(path.join(workspace, "AGENTS.md"))).toBe(true);

    // Successor can still finish without the stale side effects.
    clearJarvisCreateDeps();
    const successor = await createJarvisInSpace({
      spaceId,
      name: "stale lease",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    });
    expect(successor.session.id).toBeTruthy();
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "stale lease"))
      .get();
    expect(op?.phase).toBe("completed");
  });

  it("clears compensation flags so a user-recreated directory survives a later failure", async () => {
    installOpenCodeModelDeps({
      createOpenCodeSession: async () => ({
        ok: false,
        status: 502,
        error: "first failure",
      }),
    });
    const first = await createJarvis(spaceId, "flag clear");
    expect(first?.status).toBe(502);
    const workspace = path.join(jarvisParent, "flag-clear");
    expect(existsSync(workspace)).toBe(false);

    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, "user-kept.txt"), "replacement");
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "flag clear"))
      .get();
    expect(op?.createdWorkspace).toBe(0);

    installOpenCodeModelDeps({
      createOpenCodeSession: async () => ({
        ok: false,
        status: 502,
        error: "second failure",
      }),
    });
    // Nonempty non-jarvis content → 409, but flags must remain cleared and dir intact.
    const second = await createJarvis(spaceId, "flag clear");
    expect(second?.status).toBe(409);
    expect(existsSync(path.join(workspace, "user-kept.txt"))).toBe(true);
  });

  it("recovers OpenCode create when crash happens before local marker via create-time title", async () => {
    let crashOnce = true;
    let createdId = "";
    installOpenCodeModelDeps({
      createOpenCodeSession: async (directory, options) => {
        const created = await createOpenCodeSession(directory, options);
        if (created.ok) {
          createdId = created.session.id;
          const list = openCodeSessionsByDirectory.get(directory) ?? [];
          const row = list.find((session) => session.id === createdId);
          if (row && options?.title) row.title = options.title;
        }
        return created;
      },
      crashAfterProviderCreateBeforeMarker: (sessionId) => {
        createdId = sessionId;
        if (crashOnce) {
          crashOnce = false;
          throw new Error("crash before local marker");
        }
      },
    });

    const first = await createJarvis(spaceId, "pre marker oc");
    expect(first?.status).toBe(500);
    clearJarvisCreateDeps();
    installOpenCodeModelDeps({
      listOpenCodeSessionsForDirectory: async (directory) =>
        (openCodeSessionsByDirectory.get(directory) ?? []).map((session) => ({
          id: session.id,
          directory,
          title: session.title,
        })),
    });
    const before = sessionCounter;
    const second = await createJarvis(spaceId, "pre marker oc");
    expect(second?.status).toBe(201);
    const body = await second!.json();
    expect(body.session.id).toBe(createdId);
    expect(sessionCounter).toBe(before);
  });

  it("repairs Claude prebind when provider create failed before completion", async () => {
    let failOnce = true;
    let boundId = "";
    installOpenCodeModelDeps({
      createCliSessionRecord: async (_provider, workspacePath, _model, _deps, _effort, options) => {
        const raw = options?.preallocatedRawUuid ?? crypto.randomUUID();
        const id = `cc_${raw}`;
        boundId = id;
        ensureSession(id);
        if (options?.bindMarker) setSessionAliasIfSafe(id, options.bindMarker);
        if (failOnce) {
          failOnce = false;
          throw new Error("claude provider init failed");
        }
        const { setSessionCwd } = await import("./sessions.ts");
        return setSessionCwd(id, workspacePath);
      },
    });

    const first = await createJarvisInSpace({
      spaceId,
      name: "claude prebind",
      provider: "claude",
      modelID: "opus",
    }).catch((error: Error) => error);
    expect(first).toBeInstanceOf(Error);
    expect(boundId).toMatch(/^cc_/);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "claude prebind"))
      .get();
    expect(op?.sessionId).toBe(boundId);
    expect(op?.providerCreateComplete).toBe(0);

    const second = await createJarvisInSpace({
      spaceId,
      name: "claude prebind",
      provider: "claude",
      modelID: "opus",
    });
    expect(second.session.id).toBe(boundId);
    const after = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "claude prebind"))
      .get();
    expect(after?.providerCreateComplete).toBe(1);
  });

  it("repairs Cursor prebind when provider create failed before completion", async () => {
    let failOnce = true;
    let boundId = "";
    installOpenCodeModelDeps({
      createCliSessionRecord: async (_provider, workspacePath, _model, _deps, _effort, options) => {
        const raw = options?.preallocatedRawUuid ?? crypto.randomUUID();
        const id = `cur_${raw}`;
        boundId = id;
        ensureSession(id);
        if (options?.bindMarker) setSessionAliasIfSafe(id, options.bindMarker);
        if (failOnce) {
          failOnce = false;
          throw new Error("cursor provider init failed");
        }
        const { setSessionCwd } = await import("./sessions.ts");
        return setSessionCwd(id, workspacePath);
      },
    });

    const first = await createJarvisInSpace({
      spaceId,
      name: "cursor prebind",
      provider: "cursor",
      modelID: "composer-1",
    }).catch((error: Error) => error);
    expect(first).toBeInstanceOf(Error);
    expect(boundId).toMatch(/^cur_/);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "cursor prebind"))
      .get();
    expect(op?.sessionId).toBe(boundId);
    expect(op?.providerCreateComplete).toBe(0);

    const second = await createJarvisInSpace({
      spaceId,
      name: "cursor prebind",
      provider: "cursor",
      modelID: "composer-1",
    });
    expect(second.session.id).toBe(boundId);
    const after = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "cursor prebind"))
      .get();
    expect(after?.providerCreateComplete).toBe(1);
  });

  it("re-enqueues bootstrap when the message exists but the job was never written", async () => {
    const first = await createJarvis(spaceId, "bootstrap enqueue");
    const firstBody = await first!.json();
    const sessionId = firstBody.session.id as string;
    const { opencodeDeliveryJobs } = await import("./db/drizzle-schema.ts");
    const bootstrap = drizzleDb
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all()
      .find((row) => row.clientMessageId?.startsWith("jarvis-bootstrap:"));
    expect(bootstrap).toBeTruthy();
    drizzleDb
      .delete(opencodeDeliveryJobs)
      .where(eq(opencodeDeliveryJobs.messageId, bootstrap!.id))
      .run();
    drizzleDb
      .update(jarvisCreateOperations)
      .set({ phase: "bootstrapping" })
      .where(eq(jarvisCreateOperations.sessionId, sessionId))
      .run();

    const second = await createJarvis(spaceId, "bootstrap enqueue");
    expect(second?.status).toBe(201);
    const job = drizzleDb
      .select()
      .from(opencodeDeliveryJobs)
      .where(eq(opencodeDeliveryJobs.messageId, bootstrap!.id))
      .get();
    expect(job).toBeTruthy();
  });

  it("does not reset a succeeded bootstrap job or message on retry", async () => {
    const { updateOpencodeDelivery } = await import("./messages.ts");
    const { opencodeDeliveryJobs } = await import("./db/drizzle-schema.ts");
    const first = await createJarvis(spaceId, "bootstrap succeeded");
    const firstBody = await first!.json();
    const sessionId = firstBody.session.id as string;
    const bootstrap = drizzleDb
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all()
      .find((row) => row.clientMessageId?.startsWith("jarvis-bootstrap:"));
    expect(bootstrap).toBeTruthy();
    updateOpencodeDelivery(bootstrap!.id, "sent", null, "oc_msg_bootstrap");
    drizzleDb
      .update(opencodeDeliveryJobs)
      .set({ status: "succeeded" })
      .where(eq(opencodeDeliveryJobs.messageId, bootstrap!.id))
      .run();
    drizzleDb
      .update(jarvisCreateOperations)
      .set({ phase: "bootstrapping", bootstrapStatus: "queued" })
      .where(eq(jarvisCreateOperations.sessionId, sessionId))
      .run();

    const second = await createJarvis(spaceId, "bootstrap succeeded");
    expect(second?.status).toBe(201);
    const secondBody = await second!.json();
    expect(secondBody.bootstrapStatus).toBe("delivered");
    const message = drizzleDb.select().from(messages).where(eq(messages.id, bootstrap!.id)).get();
    expect(message?.opencodeDeliveryStatus).toBe("sent");
    const job = drizzleDb
      .select()
      .from(opencodeDeliveryJobs)
      .where(eq(opencodeDeliveryJobs.messageId, bootstrap!.id))
      .get();
    expect(job?.status).toBe("succeeded");
  });

  it("reports bootstrap delivered when the message delivery status is sent", async () => {
    const { updateOpencodeDelivery } = await import("./messages.ts");
    const { opencodeDeliveryJobs } = await import("./db/drizzle-schema.ts");
    const created = await createJarvisInSpace({
      spaceId,
      name: "bootstrap sent",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    });
    const bootstrap = drizzleDb
      .select()
      .from(messages)
      .where(eq(messages.sessionId, created.session.id))
      .all()
      .find((row) => row.clientMessageId?.startsWith("jarvis-bootstrap:"));
    const messageId = bootstrap!.id;
    updateOpencodeDelivery(messageId, "sent", null, "oc_sent");
    drizzleDb
      .update(opencodeDeliveryJobs)
      .set({ status: "succeeded" })
      .where(eq(opencodeDeliveryJobs.messageId, messageId))
      .run();
    drizzleDb
      .update(jarvisCreateOperations)
      .set({ phase: "bootstrapping" })
      .where(eq(jarvisCreateOperations.sessionId, created.session.id))
      .run();

    const again = await createJarvisInSpace({
      spaceId,
      name: "bootstrap sent",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    });
    expect(again.bootstrapStatus).toBe("delivered");
  });

  it("exposes Codex remote-orphan crash before ensureSession without claiming exact recovery", async () => {
    const { createCliSessionRecord } = await import("./external-cli/create-cli-session.ts");
    const { getSession } = await import("./sessions.ts");
    let crashOnce = true;
    let remoteId = "";
    installOpenCodeModelDeps({
      createCliSessionRecord: (provider, workspacePath, model, _deps, effort, options) =>
        createCliSessionRecord(
          provider,
          workspacePath,
          model,
          {
            bootstrapCodexThread: async () => crypto.randomUUID(),
          },
          effort,
          options,
        ),
      crashAfterProviderBootstrapBeforeLocalSession: (sessionId) => {
        if (crashOnce) {
          remoteId = sessionId;
          crashOnce = false;
          throw new Error("codex crash after bootstrap before local session");
        }
      },
    });

    const first = await createJarvisInSpace({
      spaceId,
      name: "codex orphan",
      provider: "codex",
      modelID: "gpt-5",
    }).catch((error: Error) => error);
    expect(first).toBeInstanceOf(Error);
    expect(remoteId).toMatch(/^cx_/);
    expect(getSession(remoteId)).toBeNull();
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "codex orphan"))
      .get();
    expect(op?.sessionId).toBeNull();
    expect(getSessionByAlias(jarvisOperationBindMarker(op!.id))).toBeNull();

    // Retry allocates a new remote session — orphan window is not exact-once recoverable.
    const second = await createJarvisInSpace({
      spaceId,
      name: "codex orphan",
      provider: "codex",
      modelID: "gpt-5",
    });
    expect(second.session.id).toMatch(/^cx_/);
    expect(second.session.id).not.toBe(remoteId);
  });

  it("exposes Grok remote-orphan crash before ensureSession without claiming exact recovery", async () => {
    const { createCliSessionRecord } = await import("./external-cli/create-cli-session.ts");
    const { getSession } = await import("./sessions.ts");
    let crashOnce = true;
    let remoteId = "";
    installOpenCodeModelDeps({
      createCliSessionRecord: (provider, workspacePath, model, _deps, effort, options) =>
        createCliSessionRecord(
          provider,
          workspacePath,
          model,
          {
            bootstrapGrokSession: async () => crypto.randomUUID(),
          },
          effort,
          options,
        ),
      crashAfterProviderBootstrapBeforeLocalSession: (sessionId) => {
        if (crashOnce) {
          remoteId = sessionId;
          crashOnce = false;
          throw new Error("grok crash after bootstrap before local session");
        }
      },
    });

    const first = await createJarvisInSpace({
      spaceId,
      name: "grok orphan",
      provider: "grok",
      modelID: "grok-4.5",
    }).catch((error: Error) => error);
    expect(first).toBeInstanceOf(Error);
    expect(remoteId).toMatch(/^gr_/);
    expect(getSession(remoteId)).toBeNull();

    const second = await createJarvisInSpace({
      spaceId,
      name: "grok orphan",
      provider: "grok",
      modelID: "grok-4.5",
    });
    expect(second.session.id).toMatch(/^gr_/);
    expect(second.session.id).not.toBe(remoteId);
  });

  it("aborts stale compensation after CAS claim when lease is stolen before side effects", async () => {
    const workspace = path.join(jarvisParent, "stale-comp");
    installOpenCodeModelDeps({
      createOpenCodeSession: async () => ({
        ok: false,
        status: 502,
        error: "provider fail for compensation",
      }),
      crashAfterCompensationClaim: () => {
        const op = drizzleDb
          .select()
          .from(jarvisCreateOperations)
          .where(eq(jarvisCreateOperations.alias, "stale comp"))
          .get();
        drizzleSqlite
          .prepare(
            `UPDATE jarvis_create_operations SET lease_owner = ?, leased_at = ? WHERE id = ?`,
          )
          .run("successor-owner", Date.now() - 60_000, op!.id);
      },
    });

    const stale = await createJarvisInSpace({
      spaceId,
      name: "stale comp",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    }).catch((error: Error) => error);
    expect(stale).toBeInstanceOf(Error);
    expect((stale as Error).message).toMatch(/lease/i);
    // Flags cleared by CAS claim; directory must survive because rm never ran.
    expect(existsSync(path.join(workspace, "AGENTS.md"))).toBe(true);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "stale comp"))
      .get();
    expect(op?.createdWorkspace).toBe(0);

    clearJarvisCreateDeps();
    const successor = await createJarvisInSpace({
      spaceId,
      name: "stale comp",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    });
    expect(successor.session.id).toBeTruthy();
    expect(existsSync(path.join(workspace, "AGENTS.md"))).toBe(true);
  });

  it("does not re-delete after crash between compensation claim and workspace rm", async () => {
    const workspace = path.join(jarvisParent, "comp-crash");
    installOpenCodeModelDeps({
      createOpenCodeSession: async () => ({
        ok: false,
        status: 502,
        error: "first fail",
      }),
      crashAfterCompensationClaim: () => {
        throw new Error("crash after compensation claim");
      },
    });
    const first = await createJarvisInSpace({
      spaceId,
      name: "comp crash",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    }).catch((error: Error) => error);
    expect(first).toBeInstanceOf(Error);
    // Claim cleared flags but rm never ran — workspace still on disk.
    expect(existsSync(workspace)).toBe(true);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "comp crash"))
      .get();
    expect(op?.createdWorkspace).toBe(0);

    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, "user-kept.txt"), "replacement");

    installOpenCodeModelDeps({
      createOpenCodeSession: async () => ({
        ok: false,
        status: 502,
        error: "second fail",
      }),
    });
    const second = await createJarvis(spaceId, "comp crash");
    expect(second?.status).toBe(502);
    expect(existsSync(path.join(workspace, "user-kept.txt"))).toBe(true);
  });

  it("resumes after crash between staging ownership and materialize", async () => {
    let crashOnce = true;
    installOpenCodeModelDeps({
      crashAfterStagingMkdirBeforeMaterialize: () => {
        if (!crashOnce) return;
        crashOnce = false;
        const op = drizzleDb
          .select()
          .from(jarvisCreateOperations)
          .where(eq(jarvisCreateOperations.alias, "stage mkdir"))
          .get();
        // Steal lease so catch skips compensate — simulates a hard process crash.
        drizzleSqlite
          .prepare(
            `UPDATE jarvis_create_operations SET lease_owner = ?, leased_at = ? WHERE id = ?`,
          )
          .run("crashed-owner", Date.now() - 60_000, op!.id);
        throw new Error("crash after mkdir before materialize");
      },
    });
    const first = await createJarvisInSpace({
      spaceId,
      name: "stage mkdir",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    }).catch((error: Error) => error);
    expect(first).toBeInstanceOf(Error);
    const workspace = path.join(jarvisParent, "stage-mkdir");
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "stage mkdir"))
      .get();
    expect(op?.createdWorkspace).toBe(1);
    expect(existsSync(workspace)).toBe(true);

    clearJarvisCreateDeps();
    const second = await createJarvisInSpace({
      spaceId,
      name: "stage mkdir",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    });
    expect(second.session.id).toBeTruthy();
    expect(existsSync(path.join(workspace, "AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(workspace, ".git"))).toBe(true);
  });

  it("resumes after crash between materialize and git init", async () => {
    let crashOnce = true;
    installOpenCodeModelDeps({
      crashAfterStagingMaterialize: () => {
        if (!crashOnce) return;
        crashOnce = false;
        const op = drizzleDb
          .select()
          .from(jarvisCreateOperations)
          .where(eq(jarvisCreateOperations.alias, "stage materialize"))
          .get();
        drizzleSqlite
          .prepare(
            `UPDATE jarvis_create_operations SET lease_owner = ?, leased_at = ? WHERE id = ?`,
          )
          .run("crashed-owner", Date.now() - 60_000, op!.id);
        throw new Error("crash after materialize");
      },
    });
    const first = await createJarvisInSpace({
      spaceId,
      name: "stage materialize",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    }).catch((error: Error) => error);
    expect(first).toBeInstanceOf(Error);
    const workspace = path.join(jarvisParent, "stage-materialize");
    expect(existsSync(path.join(workspace, "AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(workspace, ".git"))).toBe(false);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "stage materialize"))
      .get();
    expect(op?.createdWorkspace).toBe(1);

    clearJarvisCreateDeps();
    const second = await createJarvisInSpace({
      spaceId,
      name: "stage materialize",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    });
    expect(second.session.id).toBeTruthy();
    expect(existsSync(path.join(workspace, ".git"))).toBe(true);
  });

  it("does not claim a pre-existing AGENTS.md directory as owned staging", async () => {
    const workspace = path.join(jarvisParent, "user-agents");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, "AGENTS.md"), "# user notes\n");
    writeFileSync(path.join(workspace, "notes.txt"), "keep me");

    const result = await createJarvis(spaceId, "user agents");
    expect(result?.status).toBe(409);
    expect(existsSync(path.join(workspace, "notes.txt"))).toBe(true);
    expect(readFileSync(path.join(workspace, "notes.txt"), "utf8")).toBe("keep me");
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "user agents"))
      .get();
    expect(op?.createdWorkspace ?? 0).toBe(0);
  });

  it("resumes owned mid-copy crash before AGENTS.md exists", async () => {
    let crashOnce = true;
    installOpenCodeModelDeps({
      crashDuringStagingMaterialize: () => {
        if (!crashOnce) return;
        crashOnce = false;
        const op = drizzleDb
          .select()
          .from(jarvisCreateOperations)
          .where(eq(jarvisCreateOperations.alias, "mid copy"))
          .get();
        drizzleSqlite
          .prepare(
            `UPDATE jarvis_create_operations SET lease_owner = ?, leased_at = ? WHERE id = ?`,
          )
          .run("crashed-owner", Date.now() - 60_000, op!.id);
        throw new Error("crash mid materialize copy");
      },
    });
    const first = await createJarvisInSpace({
      spaceId,
      name: "mid copy",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    }).catch((error: Error) => error);
    expect(first).toBeInstanceOf(Error);
    const workspace = path.join(jarvisParent, "mid-copy");
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "mid copy"))
      .get();
    expect(op?.createdWorkspace).toBe(1);
    expect(existsSync(workspace)).toBe(true);
    // May or may not have AGENTS.md yet depending on copy order — must still resume.
    expect(existsSync(path.join(workspace, ".git"))).toBe(false);

    clearJarvisCreateDeps();
    const second = await createJarvisInSpace({
      spaceId,
      name: "mid copy",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    });
    expect(second.session.id).toBeTruthy();
    expect(existsSync(path.join(workspace, "AGENTS.md"))).toBe(true);
    expect(existsSync(path.join(workspace, ".git"))).toBe(true);
  });

  it("does not take ownership of a newly attached link if crash hits before the flag is persisted", async () => {
    let crashOnce = true;
    installOpenCodeModelDeps({
      crashAfterAttachBeforeCreatedAttachment: () => {
        if (!crashOnce) return;
        crashOnce = false;
        const op = drizzleDb
          .select()
          .from(jarvisCreateOperations)
          .where(eq(jarvisCreateOperations.alias, "attach claim"))
          .get();
        drizzleSqlite
          .prepare(
            `UPDATE jarvis_create_operations SET lease_owner = ?, leased_at = ? WHERE id = ?`,
          )
          .run("crashed-owner", Date.now() - 60_000, op!.id);
        throw new Error("crash after attach before flag");
      },
    });
    const first = await createJarvisInSpace({
      spaceId,
      name: "attach claim",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    }).catch((error: Error) => error);
    expect(first).toBeInstanceOf(Error);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "attach claim"))
      .get();
    // Ambiguous ownership — flag must stay unset so we never compensate-release.
    expect(op?.createdAttachment).toBe(0);
    expect(
      drizzleDb.select().from(spaceRepositories).where(eq(spaceRepositories.spaceId, spaceId)).all()
        .length,
    ).toBeGreaterThan(0);

    clearJarvisCreateDeps();
    const second = await createJarvisInSpace({
      spaceId,
      name: "attach claim",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    });
    expect(second.session.id).toBeTruthy();
  });

  it("never releases a pre-existing space link after crash retry then provider failure", async () => {
    const { applySpaceAction } = await import("./spaces.ts");
    const workspace = path.join(jarvisParent, "preexisting-link");
    seedExistingJarvisRepo(workspace, "user content");
    const attached = await applySpaceAction(spaceId, {
      action: "attachRepository",
      path: workspace,
      name: "preexisting-link",
    });
    const repoId =
      "repositoryId" in attached && typeof attached.repositoryId === "string"
        ? attached.repositoryId
        : null;
    expect(repoId).toBeTruthy();

    let crashOnce = true;
    installOpenCodeModelDeps({
      crashAfterAttachBeforeCreatedAttachment: () => {
        if (!crashOnce) return;
        crashOnce = false;
        const op = drizzleDb
          .select()
          .from(jarvisCreateOperations)
          .where(eq(jarvisCreateOperations.alias, "preexisting link"))
          .get();
        drizzleSqlite
          .prepare(
            `UPDATE jarvis_create_operations SET lease_owner = ?, leased_at = ? WHERE id = ?`,
          )
          .run("crashed-owner", Date.now() - 60_000, op!.id);
        throw new Error("crash on pre-existing attach");
      },
    });
    await createJarvisInSpace({
      spaceId,
      name: "preexisting link",
      provider: "opencode",
      modelID: "openai/gpt-4.1-mini",
    }).catch(() => undefined);

    const afterCrash = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "preexisting link"))
      .get();
    expect(afterCrash?.createdAttachment).toBe(0);

    installOpenCodeModelDeps({
      createOpenCodeSession: async () => ({
        ok: false,
        status: 502,
        error: "provider fail after retry",
      }),
    });
    const failed = await createJarvis(spaceId, "preexisting link");
    expect(failed?.status).toBe(502);

    const link = drizzleDb
      .select()
      .from(spaceRepositories)
      .where(
        and(eq(spaceRepositories.spaceId, spaceId), eq(spaceRepositories.repositoryId, repoId!)),
      )
      .get();
    expect(link).toBeTruthy();
    expect(existsSync(path.join(workspace, "user-notes.md"))).toBe(true);
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "preexisting link"))
      .get();
    expect(op?.createdAttachment).toBe(0);
    expect(op?.createdWorkspace).toBe(0);
  });

  it("passes bind marker into Codex bootstrap prompt", async () => {
    const { createCliSessionRecord } = await import("./external-cli/create-cli-session.ts");
    let seenPrompt = "";
    installOpenCodeModelDeps({
      createCliSessionRecord: (provider, workspacePath, model, _deps, effort, options) =>
        createCliSessionRecord(
          provider,
          workspacePath,
          model,
          {
            bootstrapCodexThread: async (input) => {
              seenPrompt = input.prompt ?? "";
              return crypto.randomUUID();
            },
          },
          effort,
          options,
        ),
    });
    await createJarvisInSpace({
      spaceId,
      name: "codex marker prompt",
      provider: "codex",
      modelID: "gpt-5",
    });
    const op = drizzleDb
      .select()
      .from(jarvisCreateOperations)
      .where(eq(jarvisCreateOperations.alias, "codex marker prompt"))
      .get();
    expect(seenPrompt).toContain(jarvisOperationBindMarker(op!.id));
  });

  it("runs compensation release then workspace rm under lease with crash hooks", async () => {
    const workspace = path.join(jarvisParent, "comp-hooks");
    let sawRelease = false;
    let sawRm = false;
    installOpenCodeModelDeps({
      createOpenCodeSession: async () => ({
        ok: false,
        status: 502,
        error: "fail for hooks",
      }),
      crashAfterCompensationRelease: () => {
        sawRelease = true;
      },
      crashAfterCompensationWorkspaceRm: () => {
        sawRm = true;
      },
    });
    const result = await createJarvis(spaceId, "comp hooks");
    expect(result?.status).toBe(502);
    expect(sawRelease).toBe(true);
    expect(sawRm).toBe(true);
    expect(existsSync(workspace)).toBe(false);
  });
});
