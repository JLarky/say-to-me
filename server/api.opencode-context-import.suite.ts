import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type ApiSession,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  listen,
  mockOpenCode,
  createTestSession,
} from "./api.harness.ts";

describe("say API: OpenCode context import", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  it("captures and persists OpenCode project/workspace context at import time", async () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "say-to-me-opencode-ctx-"));
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/project/current")) {
        res.end(
          JSON.stringify({
            id: "prj_abc123",
            worktree: "/home/dev/projects/say-to-me",
            vcs: "git",
            name: "say-to-me",
            sandboxes: [],
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      if (req.url?.startsWith("/vcs")) {
        res.end(JSON.stringify({ branch: "opencode/eager-harbor", default_branch: "main" }));
        return;
      }
      res.end(
        JSON.stringify({
          id: "ses_96fe67288c9eLPx8vWs9hQ0ffZ",
          slug: "ctx",
          title: "ctx workspace",
          directory: workspacePath,
          projectID: "prj_fromsession",
          workspaceID: "wrk_xyz789",
          path: "/home/dev/projects/say-to-me/packages/web",
          version: "1.0.0",
          time: { created: 1, updated: 2 },
        }),
      );
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/opencode-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workspacePath }),
      });
      const payload = await response.json();
      expect(response.status).toBe(201);
      expect(payload.session).toMatchObject({
        id: "ses_96fe67288c9eLPx8vWs9hQ0ffZ",
        opencodeProjectId: "prj_abc123",
        opencodeWorkspaceId: "wrk_xyz789",
        opencodeDirectory: workspacePath,
        opencodeWorktree: "/home/dev/projects/say-to-me",
        opencodePath: "/home/dev/projects/say-to-me/packages/web",
        opencodeProjectName: "say-to-me",
        opencodeBranch: "opencode/eager-harbor",
      });

      process.env.SAY_TO_ME_OPENCODE_URL = "http://127.0.0.1:1";
      const list = await fetch(`${origin}/api/sessions`).then((r) => r.json());
      const stored = list.sessions.find(
        (s: ApiSession) => s.id === "ses_96fe67288c9eLPx8vWs9hQ0ffZ",
      );
      expect(stored).toMatchObject({
        opencodeProjectId: "prj_abc123",
        opencodeWorkspaceId: "wrk_xyz789",
        opencodeWorktree: "/home/dev/projects/say-to-me",
        opencodePath: "/home/dev/projects/say-to-me/packages/web",
        opencodeProjectName: "say-to-me",
        opencodeBranch: "opencode/eager-harbor",
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      rmSync(workspacePath, { recursive: true, force: true });
      server.close();
    }
  });

  it("lazily re-imports OpenCode context for a session that has none cached", async () => {
    const sessionId = "ses_4e9a2273b4558YsRd1jq5JvYxT";
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    await createTestSession(sessionId);
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/project/current")) {
        res.end(
          JSON.stringify({
            id: "prj_backfill",
            worktree: "/home/dev/projects/say-to-me",
            vcs: "git",
            name: "say-to-me",
            sandboxes: [],
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ [sessionId]: { type: "idle" } }));
        return;
      }
      res.end(
        JSON.stringify({
          id: sessionId,
          slug: "backfill",
          title: "backfill workspace",
          directory: "/tmp/backfill-project",
          projectID: "prj_fromsession",
          workspaceID: "wrk_backfill",
          path: "/home/dev/projects/say-to-me/packages/web",
          version: "1.0.0",
          time: { created: 1, updated: 2 },
        }),
      );
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const payload = await fetch(`${origin}/api/sessions/${sessionId}/messages`).then((response) =>
        response.json(),
      );

      expect(payload.session).toMatchObject({
        id: sessionId,
        opencodeProjectId: "prj_backfill",
        opencodeWorkspaceId: "wrk_backfill",
        opencodeWorktree: "/home/dev/projects/say-to-me",
        opencodePath: "/home/dev/projects/say-to-me/packages/web",
        opencodeProjectName: "say-to-me",
      });

      process.env.SAY_TO_ME_OPENCODE_URL = "http://127.0.0.1:1";
      const list = await fetch(`${origin}/api/sessions`).then((r) => r.json());
      const stored = list.sessions.find((s: ApiSession) => s.id === sessionId);
      expect(stored).toMatchObject({
        opencodeProjectId: "prj_backfill",
        opencodeWorktree: "/home/dev/projects/say-to-me",
        opencodeProjectName: "say-to-me",
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("re-imports OpenCode context on demand via the dev endpoint, overwriting stale rows", async () => {
    const sessionId = "ses_a8136f0ed8f4PSeSgBSc2O9xMd";
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/project/current")) {
        res.end(
          JSON.stringify({
            id: "prj_reimport",
            worktree: "/home/dev/projects/say-to-me",
            vcs: "git",
            name: "say-to-me",
            sandboxes: [],
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      if (req.url?.startsWith("/vcs")) {
        res.end(JSON.stringify({ branch: "opencode/eager-harbor", default_branch: "main" }));
        return;
      }
      res.end(
        JSON.stringify({
          id: sessionId,
          slug: "reimport",
          title: "reimport workspace",
          directory: "/tmp/reimport-project",
          projectID: "prj_fromsession",
          workspaceID: "wrk_reimport",
          path: "/home/dev/projects/say-to-me/packages/web",
          version: "1.0.0",
          time: { created: 1, updated: 2 },
        }),
      );
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(`${origin}/api/dev/sessions/${sessionId}/reimport-context`, {
        method: "POST",
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.session).toMatchObject({
        id: sessionId,
        opencodeProjectId: "prj_reimport",
        opencodeWorkspaceId: "wrk_reimport",
        opencodeWorktree: "/home/dev/projects/say-to-me",
        opencodeProjectName: "say-to-me",
        opencodeBranch: "opencode/eager-harbor",
      });

      process.env.SAY_TO_ME_OPENCODE_URL = "http://127.0.0.1:1";
      const list = await fetch(`${origin}/api/sessions`).then((r) => r.json());
      const stored = list.sessions.find((s: ApiSession) => s.id === sessionId);
      expect(stored).toMatchObject({
        opencodeProjectId: "prj_reimport",
        opencodeBranch: "opencode/eager-harbor",
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });
});
