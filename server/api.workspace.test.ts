import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type TestServer,
  clearQueue,
  closeTestServer,
  createApiMiddleware,
  listen,
  teardownApi,
} from "./api.harness.ts";
import {
  createWorkspacePathEffect,
  suggestTempWorkspacePathEffect,
  workspacePathStatusEffect,
} from "./api-routes/workspace-path.ts";

describe("say API: workspace", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("checks and creates workspace folders", async () => {
    const workspacePath = path.join(tmpdir(), `say-to-me-workspace-${Date.now()}`);
    try {
      const missing = await Effect.runPromise(workspacePathStatusEffect(workspacePath));
      expect(missing).toMatchObject({
        path: workspacePath,
        exists: false,
        isDirectory: false,
        creatable: true,
      });

      const created = await Effect.runPromise(createWorkspacePathEffect(workspacePath));
      expect(created).toMatchObject({
        path: workspacePath,
        exists: true,
        isDirectory: true,
        writable: true,
      });
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
      await closeTestServer(server);
    }
  });

  it("suggests a temp workspace path without creating it", async () => {
    try {
      const payload = await Effect.runPromise(suggestTempWorkspacePathEffect);
      expect(payload.path).toContain(path.join(tmpdir(), "say-to-me-"));
      expect(payload.parentPath).toBe(path.dirname(payload.path));
      expect(payload.path).toMatch(/say-to-me-[0-9a-f]{6}$/);
    } finally {
      await closeTestServer(server);
    }
  });

  it("resolves a relative path from $HOME", async () => {
    const absolute = mkdtempSync(path.join(homedir(), "say-to-me-rel-"));
    const relative = path.relative(homedir(), absolute);
    try {
      const status = await Effect.runPromise(workspacePathStatusEffect(relative));
      expect(status).toMatchObject({
        path: absolute,
        exists: true,
        isDirectory: true,
        writable: true,
      });
    } finally {
      rmSync(absolute, { recursive: true, force: true });
      await closeTestServer(server);
    }
  });

  it("does not offer folder creation when the parent is not writable", async () => {
    const parentPath = mkdtempSync(path.join(tmpdir(), "say-to-me-readonly-"));
    const workspacePath = path.join(parentPath, "child");
    chmodSync(parentPath, 0o500);

    try {
      const status = await Effect.runPromise(workspacePathStatusEffect(workspacePath));
      expect(status).toMatchObject({
        path: workspacePath,
        exists: false,
        creatable: false,
        parentPath,
      });
    } finally {
      chmodSync(parentPath, 0o700);
      rmSync(parentPath, { recursive: true, force: true });
      await closeTestServer(server);
    }
  });
});

describe("workspace creation Effect route logic", () => {
  it("returns the typed route error when the path is not a directory", async () => {
    const workspacePath = path.join(tmpdir(), `say-to-me-effect-file-${Date.now()}`);
    writeFileSync(workspacePath, "not a directory");

    try {
      const error = await Effect.runPromise(Effect.flip(createWorkspacePathEffect(workspacePath)));
      expect(error).toEqual({ error: "Path exists but is not a directory.", status: 400 });
    } finally {
      rmSync(workspacePath, { force: true });
    }
  });

  it("returns the typed route error when the parent directory is not writable", async () => {
    const parentPath = mkdtempSync(path.join(tmpdir(), "say-to-me-effect-readonly-"));
    const workspacePath = path.join(parentPath, "child");
    chmodSync(parentPath, 0o500);

    try {
      const error = await Effect.runPromise(Effect.flip(createWorkspacePathEffect(workspacePath)));
      expect(error).toEqual({ error: "Parent directory is not writable.", status: 400 });
    } finally {
      chmodSync(parentPath, 0o700);
      rmSync(parentPath, { recursive: true, force: true });
    }
  });
});
