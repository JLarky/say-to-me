import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Cause, Effect, Exit } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-settings-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { dispatchEffectApiRequest } = await import("./effect-api.ts");
const { drizzleSqlite } = await import("../db/index.ts");
const {
  ensureT3ServerInstanceAccessToken,
  ensureT3ServerInstanceAccessTokenEffect,
  getStoredT3ServerInstance,
  getValidT3ServerInstanceAccessToken,
  makeT3AccessTokenIssuerLive,
  setT3ServerInstanceAccessToken,
  T3AccessTokenError,
  T3AccessTokenStoreLive,
} = await import("../settings.ts");

async function settingsRequest(method = "GET", body?: Record<string, unknown>) {
  const init: RequestInit = {
    method,
    headers: { "content-type": "application/json" },
  };
  if (method === "PATCH") {
    init.body = JSON.stringify(body ?? {});
  }
  return dispatchEffectApiRequest(new Request("http://say.local/api/settings", init));
}

describe("Settings API", () => {
  beforeEach(() => {
    drizzleSqlite.prepare("DELETE FROM app_settings").run();
  });

  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("returns the default Paseo instance before any are configured", async () => {
    const response = await settingsRequest();
    expect(response?.status).toBe(200);
    expect(await response!.json()).toEqual({
      preferredWorktreeParentPath: null,
      preferredJarvisParentPath: null,
      t3ServerInstances: [],
      paseoInstances: [{ id: "default", host: "127.0.0.1:6767" }],
      opencodeInstances: [{ id: "default" }],
    });
  });

  it("trims, persists, and clears the preferred worktree parent without touching Jarvis", async () => {
    const updated = await settingsRequest("PATCH", {
      preferredWorktreeParentPath: "  /home/example/worktrees  ",
    });
    expect(updated?.status).toBe(200);
    expect(await updated!.json()).toEqual({
      preferredWorktreeParentPath: "/home/example/worktrees",
      preferredJarvisParentPath: null,
      t3ServerInstances: [],
      paseoInstances: [{ id: "default", host: "127.0.0.1:6767" }],
      opencodeInstances: [{ id: "default" }],
    });

    const persisted = await settingsRequest();
    expect(await persisted!.json()).toEqual({
      preferredWorktreeParentPath: "/home/example/worktrees",
      preferredJarvisParentPath: null,
      t3ServerInstances: [],
      paseoInstances: [{ id: "default", host: "127.0.0.1:6767" }],
      opencodeInstances: [{ id: "default" }],
    });

    const cleared = await settingsRequest("PATCH", { preferredWorktreeParentPath: "   " });
    expect(await cleared!.json()).toEqual({
      preferredWorktreeParentPath: null,
      preferredJarvisParentPath: null,
      t3ServerInstances: [],
      paseoInstances: [{ id: "default", host: "127.0.0.1:6767" }],
      opencodeInstances: [{ id: "default" }],
    });
  });

  it("trims, persists, and clears the preferred Jarvis parent without touching worktrees", async () => {
    await settingsRequest("PATCH", {
      preferredWorktreeParentPath: "/home/example/worktrees",
    });

    const updated = await settingsRequest("PATCH", {
      preferredJarvisParentPath: "  ~/.say-to-me/jarvis  ",
    });
    expect(updated?.status).toBe(200);
    expect(await updated!.json()).toEqual({
      preferredWorktreeParentPath: "/home/example/worktrees",
      preferredJarvisParentPath: "~/.say-to-me/jarvis",
      t3ServerInstances: [],
      paseoInstances: [{ id: "default", host: "127.0.0.1:6767" }],
      opencodeInstances: [{ id: "default" }],
    });

    const cleared = await settingsRequest("PATCH", { preferredJarvisParentPath: null });
    expect(await cleared!.json()).toEqual({
      preferredWorktreeParentPath: "/home/example/worktrees",
      preferredJarvisParentPath: null,
      t3ServerInstances: [],
      paseoInstances: [{ id: "default", host: "127.0.0.1:6767" }],
      opencodeInstances: [{ id: "default" }],
    });
  });

  it("adds, edits, and replaces T3 server instances without clobbering path prefs", async () => {
    await settingsRequest("PATCH", {
      preferredWorktreeParentPath: "/home/example/worktrees",
      preferredJarvisParentPath: "~/.say-to-me/jarvis",
    });

    const created = await settingsRequest("PATCH", {
      t3ServerInstances: [
        {
          id: "  default  ",
          baseDir: "  /data/t3  ",
          originUrl: "  http://localhost:5470/  ",
          isDev: false,
        },
      ],
      paseoInstances: [],
    });
    expect(created?.status).toBe(200);
    expect(await created!.json()).toEqual({
      preferredWorktreeParentPath: "/home/example/worktrees",
      preferredJarvisParentPath: "~/.say-to-me/jarvis",
      paseoInstances: [{ id: "default", host: "127.0.0.1:6767" }],
      opencodeInstances: [{ id: "default" }],
      t3ServerInstances: [
        {
          id: "default",
          baseDir: "/data/t3",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
      ],
    });

    const edited = await settingsRequest("PATCH", {
      t3ServerInstances: [
        {
          id: "default",
          baseDir: "/data/t3-prod",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
        {
          id: "staging",
          baseDir: "/data/t3-staging",
          originUrl: "http://localhost:5471/",
          isDev: false,
        },
      ],
    });
    expect(edited?.status).toBe(200);
    expect(await edited!.json()).toMatchObject({
      preferredWorktreeParentPath: "/home/example/worktrees",
      preferredJarvisParentPath: "~/.say-to-me/jarvis",
      t3ServerInstances: [
        {
          id: "default",
          baseDir: "/data/t3-prod",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
        {
          id: "staging",
          baseDir: "/data/t3-staging",
          originUrl: "http://localhost:5471/",
          isDev: false,
        },
      ],
    });

    const persisted = await settingsRequest();
    expect(await persisted!.json()).toMatchObject({
      t3ServerInstances: [
        {
          id: "default",
          baseDir: "/data/t3-prod",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
        {
          id: "staging",
          baseDir: "/data/t3-staging",
          originUrl: "http://localhost:5471/",
          isDev: false,
        },
      ],
    });
  });

  it("trims and persists Paseo instances independently", async () => {
    const updated = await settingsRequest("PATCH", {
      paseoInstances: [
        {
          id: "  local  ",
          binPath: "  /opt/paseo  ",
          home: "  ~/.paseo-local  ",
          host: "  127.0.0.1:6767  ",
        },
      ],
    });
    expect(updated?.status).toBe(200);
    expect(await updated!.json()).toMatchObject({
      paseoInstances: [
        {
          id: "local",
          binPath: "/opt/paseo",
          home: "~/.paseo-local",
          host: "127.0.0.1:6767",
        },
      ],
    });
    expect((await settingsRequest())?.status).toBe(200);
  });

  it("rejects duplicate Paseo instance ids", async () => {
    const response = await settingsRequest("PATCH", {
      paseoInstances: [
        { id: "local", host: "127.0.0.1:6767" },
        { id: "local", host: "127.0.0.1:6768" },
      ],
    });
    expect(response?.status).toBe(400);
  });

  it("restores the default Paseo instance after the list is cleared", async () => {
    await settingsRequest("PATCH", {
      paseoInstances: [{ id: "local", host: "127.0.0.1:6768" }],
    });
    const cleared = await settingsRequest("PATCH", { paseoInstances: [] });
    expect(cleared?.status).toBe(200);
    expect(await cleared!.json()).toMatchObject({
      paseoInstances: [{ id: "default", host: "127.0.0.1:6767" }],
    });
  });

  it("rejects duplicate T3 server instance ids", async () => {
    const response = await settingsRequest("PATCH", {
      t3ServerInstances: [
        { id: "default", baseDir: "/a", originUrl: "http://localhost:5470/", isDev: false },
        { id: "default", baseDir: "/b", originUrl: "http://localhost:5471/", isDev: false },
      ],
    });
    expect(response?.status).toBe(400);
    expect(await response!.json()).toEqual({
      error: 'Duplicate T3 server instance id "default".',
    });
  });

  it("persists isDev and clears secrets when auth location fields change", async () => {
    await settingsRequest("PATCH", {
      t3ServerInstances: [
        {
          id: "default",
          baseDir: "/data/t3",
          originUrl: "http://localhost:5470/",
          isDev: true,
        },
      ],
    });
    setT3ServerInstanceAccessToken("default", "secret-token-value", Date.now() + 60_000);
    expect(getStoredT3ServerInstance("default")?.isDev).toBe(true);
    expect(getStoredT3ServerInstance("default")?.accessToken).toBe("secret-token-value");

    const flipped = await settingsRequest("PATCH", {
      t3ServerInstances: [
        {
          id: "default",
          baseDir: "/data/t3",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
      ],
    });
    expect(flipped?.status).toBe(200);
    expect(await flipped!.json()).toMatchObject({
      t3ServerInstances: [
        {
          id: "default",
          baseDir: "/data/t3",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
      ],
    });
    expect(getStoredT3ServerInstance("default")?.accessToken).toBeNull();
  });

  it("persists the per-instance T3 checkout path and clears tokens when it changes", async () => {
    const created = await settingsRequest("PATCH", {
      t3ServerInstances: [
        {
          id: "bin-path",
          binPath: "/home/jlarky.guest/work/t3code",
          baseDir: "/home/jlarky.guest/.t3",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
      ],
    });
    expect(created?.status).toBe(200);
    expect(await created!.json()).toMatchObject({
      t3ServerInstances: [
        {
          id: "bin-path",
          binPath: "/home/jlarky.guest/work/t3code",
        },
      ],
    });

    setT3ServerInstanceAccessToken("bin-path", "bin-token", Date.now() + 60_000);
    const changed = await settingsRequest("PATCH", {
      t3ServerInstances: [
        {
          id: "bin-path",
          binPath: "/home/jlarky.guest/.t3/worktrees/t3code/t3code-84ecd53",
          baseDir: "/home/jlarky.guest/.t3",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
      ],
    });
    expect(changed?.status).toBe(200);
    expect(getStoredT3ServerInstance("bin-path")?.accessToken).toBeNull();
  });

  it("rejects blank T3 server instance ids", async () => {
    const response = await settingsRequest("PATCH", {
      t3ServerInstances: [
        { id: "   ", baseDir: "/a", originUrl: "http://localhost:5470/", isDev: false },
      ],
    });
    expect(response?.status).toBe(400);
    expect(await response!.json()).toMatchObject({
      error: expect.stringContaining("needs an id"),
    });
  });

  it("keeps access tokens server-only and preserves them when auth location is unchanged", async () => {
    await settingsRequest("PATCH", {
      t3ServerInstances: [
        { id: "default", baseDir: "/data/t3", originUrl: "http://localhost:5470/", isDev: false },
      ],
    });

    const expiresAt = Date.now() + 60 * 60 * 1000;
    setT3ServerInstanceAccessToken("default", "secret-token-value", expiresAt);

    const listed = await settingsRequest();
    const listedBody = await listed!.json();
    expect(listedBody.t3ServerInstances).toEqual([
      { id: "default", baseDir: "/data/t3", originUrl: "http://localhost:5470/", isDev: false },
    ]);
    expect(JSON.stringify(listedBody)).not.toContain("secret-token-value");
    expect(JSON.stringify(listedBody)).not.toContain("accessToken");
    expect(JSON.stringify(listedBody)).not.toContain("accessTokenExpiresAt");

    // Re-saving the same baseDir/originUrl/isDev keeps the server-only secret.
    const resaved = await settingsRequest("PATCH", {
      t3ServerInstances: [
        {
          id: "default",
          baseDir: "/data/t3",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
      ],
    });
    expect(resaved?.status).toBe(200);
    const resavedBody = await resaved!.json();
    expect(JSON.stringify(resavedBody)).not.toContain("secret-token-value");
    expect(getStoredT3ServerInstance("default")?.accessToken).toBe("secret-token-value");
    expect(getStoredT3ServerInstance("default")?.accessTokenExpiresAt).toBe(expiresAt);

    // Changing baseDir (auth location) clears the secret so a fresh mint is required.
    const moved = await settingsRequest("PATCH", {
      t3ServerInstances: [
        {
          id: "default",
          baseDir: "/data/t3-edited",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
      ],
    });
    expect(moved?.status).toBe(200);
    expect(getStoredT3ServerInstance("default")?.baseDir).toBe("/data/t3-edited");
    expect(getStoredT3ServerInstance("default")?.accessToken).toBeNull();
  });

  it("reuses a non-expired access token and mints a new one when expired", async () => {
    await settingsRequest("PATCH", {
      t3ServerInstances: [
        { id: "default", baseDir: "/data/t3", originUrl: "http://localhost:5470/", isDev: false },
      ],
    });

    const futureExpiry = Date.now() + 60 * 60 * 1000;
    setT3ServerInstanceAccessToken("default", "fresh-token", futureExpiry);
    expect(getValidT3ServerInstanceAccessToken("default")).toBe("fresh-token");

    const mint = vi.fn(async () => ({
      accessToken: "should-not-run",
      accessTokenExpiresAt: Date.now() + 60_000,
    }));
    await expect(ensureT3ServerInstanceAccessToken("default", mint)).resolves.toBe("fresh-token");
    expect(mint).not.toHaveBeenCalled();

    const pastExpiry = Date.now() - 1_000;
    setT3ServerInstanceAccessToken("default", "stale-token", pastExpiry);
    expect(getValidT3ServerInstanceAccessToken("default")).toBeNull();

    const nextExpiry = Date.now() + 120_000;
    const refresh = vi.fn(async () => ({
      accessToken: "  rotated-token  ",
      accessTokenExpiresAt: nextExpiry,
    }));
    await expect(ensureT3ServerInstanceAccessToken("default", refresh)).resolves.toBe(
      "rotated-token",
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(getStoredT3ServerInstance("default")?.accessToken).toBe("rotated-token");
    expect(getStoredT3ServerInstance("default")?.accessTokenExpiresAt).toBe(nextExpiry);
    expect(getValidT3ServerInstanceAccessToken("default")).toBe("rotated-token");
  });

  it("does not persist a minted token that is already unusable under skew", async () => {
    await settingsRequest("PATCH", {
      t3ServerInstances: [
        {
          id: "mint-check",
          baseDir: "/data/t3",
          originUrl: "http://localhost:5470/",
          isDev: false,
        },
      ],
    });
    // Ensure there is no usable cached secret for this instance.
    setT3ServerInstanceAccessToken("mint-check", null, null);

    const exit = await Effect.runPromiseExit(
      ensureT3ServerInstanceAccessTokenEffect("mint-check").pipe(
        Effect.provide(
          makeT3AccessTokenIssuerLive(async () => ({
            accessToken: "too-soon",
            accessTokenExpiresAt: Date.now() + 1_000,
          })),
        ),
        Effect.provide(T3AccessTokenStoreLive),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) return;
    expect([...Cause.failures(exit.cause)]).toEqual([
      new T3AccessTokenError({
        error: "Minted T3 access token expires too soon to be used.",
        status: 400,
      }),
    ]);
    expect(getStoredT3ServerInstance("mint-check")?.accessToken).toBeNull();
  });

  it("publishes the settings endpoints in OpenAPI", async () => {
    const response = await dispatchEffectApiRequest(new Request("http://say.local/openapi.json"));
    const body = await response!.json();
    expect(body).toMatchObject({
      paths: {
        "/api/settings": {
          get: { responses: { "200": expect.anything() } },
          patch: { responses: { "200": expect.anything() } },
        },
      },
    });
  });

  it("preserves and exposes a configured remote Paseo server ID", async () => {
    const updated = await settingsRequest("PATCH", {
      paseoInstances: [
        {
          id: "remote",
          serverId: "srv_remote123",
          host: "remote-paseo:6767",
        },
      ],
    });
    expect(updated?.status).toBe(200);
    expect(await updated!.json()).toMatchObject({
      paseoInstances: [
        {
          id: "remote",
          serverId: "srv_remote123",
          host: "remote-paseo:6767",
        },
      ],
    });

    const persisted = await settingsRequest();
    expect(await persisted!.json()).toMatchObject({
      paseoInstances: [
        {
          id: "remote",
          serverId: "srv_remote123",
        },
      ],
    });
  });
});
