import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type ApiSession,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  listen,
  mockOpenCode,
  waitFor,
} from "./api.harness.ts";
import { dispatchEffectApiRequest } from "./api-routes/effect-api.ts";
import { resetJarvisCreateDepsForTest, setJarvisCreateDepsForTest } from "./jarvis-create.ts";
import { jarvisWorkspaceRoot, materializeJarvisTemplate } from "./jarvis-template.ts";

async function waitForPrompt(openCode: Awaited<ReturnType<typeof mockOpenCode>>, url: string) {
  let prompt: (typeof openCode.requests)[number] | undefined;
  await waitFor(() => {
    prompt = openCode.requests.find((request) => request.url === url);
    return prompt != null;
  });
  return prompt!;
}

function jarvisSessionRequest(name: string, spaceId: string) {
  return dispatchEffectApiRequest(
    new Request("http://say.test/api/jarvis-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        spaceId,
        provider: "opencode",
        modelID: "openai/gpt-4.1-mini",
      }),
    }),
  ).then((response) => response ?? new Response(null, { status: 404 }));
}

async function ensureJarvisSpace(): Promise<string> {
  const response = await dispatchEffectApiRequest(
    new Request("http://say.test/api/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `jarvis-space-${Date.now()}`, context: "", parentId: null }),
    }),
  );
  const body = await response!.json();
  return body.spaceId as string;
}

function settingsPatchRequest(body: Record<string, string | null>) {
  return dispatchEffectApiRequest(
    new Request("http://say.test/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  ).then((response) => response ?? new Response(null, { status: 404 }));
}

describe("say API: OpenCode session creation", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
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
    });
  });

  afterEach(() => {
    resetJarvisCreateDepsForTest();
  });

  it("creates a named Jarvis-managed scaffolded OpenCode session and bootstraps it", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    let workspacePath: string | null = null;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_c972e55b7bd8qxIK4IJ2FEl5F9: { type: "idle" } }));
        return;
      }
      if (
        req.method === "PATCH" &&
        req.url?.startsWith("/session/ses_c972e55b7bd8qxIK4IJ2FEl5F9")
      ) {
        res.end(
          JSON.stringify({
            id: "ses_c972e55b7bd8qxIK4IJ2FEl5F9",
            title: "Review checkout flow",
            directory: workspacePath,
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      if (
        req.method === "POST" &&
        req.url?.startsWith("/session/ses_c972e55b7bd8qxIK4IJ2FEl5F9/message")
      ) {
        res.end(JSON.stringify({ info: { id: "msg_jarvis_bootstrap" }, parts: [] }));
        return;
      }
      if (req.method === "POST" && req.url?.startsWith("/session")) {
        const url = new URL(req.url, "http://opencode.test");
        workspacePath = url.searchParams.get("directory");
        res.end(
          JSON.stringify({
            id: "ses_c972e55b7bd8qxIK4IJ2FEl5F9",
            title: "New session",
            directory: workspacePath,
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      res.end(JSON.stringify({}));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await jarvisSessionRequest(
        "  Review   checkout flow  ",
        await ensureJarvisSpace(),
      );
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.session).toMatchObject({
        id: "ses_c972e55b7bd8qxIK4IJ2FEl5F9",
        alias: "Review checkout flow",
        state: "jarvis",
        opencodeDirectory: workspacePath,
        opencodeTitle: "Review checkout flow",
      });
      expect(workspacePath).toBe(path.join(jarvisWorkspaceRoot(), "review-checkout-flow"));
      const worktreeCreate = openCode.requests.find(
        (request) => request.method === "POST" && request.url?.startsWith("/experimental/worktree"),
      );
      expect(worktreeCreate).toBeUndefined();
      const prompt = await waitForPrompt(
        openCode,
        "/session/ses_c972e55b7bd8qxIK4IJ2FEl5F9/message",
      );
      expect(JSON.stringify(prompt?.body)).toContain("Read AGENTS.md, README.md, sessions.md");
      expect(JSON.stringify(prompt?.body)).toContain("templates/jarvis");
      expect(JSON.stringify(prompt?.body)).toContain("Do not modify files");
      if (!workspacePath) throw new Error("Jarvis workspace path was not captured.");
      expect(existsSync(path.join(workspacePath, "AGENTS.md"))).toBe(true);
      expect(readFileSync(path.join(workspacePath, "AGENTS.md"), "utf8")).toContain(
        "templates/jarvis",
      );
      expect(existsSync(path.join(workspacePath, "bootstrap-message.md"))).toBe(true);
      expect(readFileSync(path.join(workspacePath, "sessions.md"), "utf8")).toContain(
        "ses_c972e55b7bd8qxIK4IJ2FEl5F9",
      );
      expect(existsSync(path.join(workspacePath, "tasks.md"))).toBe(true);
      expect(existsSync(path.join(workspacePath, "artifacts.md"))).toBe(true);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      if (workspacePath) rmSync(workspacePath, { recursive: true, force: true });
      server.close();
    }
  });

  it("uses the preferred Jarvis parent from settings for the OpenCode directory", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const preferredParent = mkdtempSync(path.join(tmpdir(), "say-to-me-jarvis-preferred-"));
    let workspacePath: string | null = null;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_f94cdc23a1e7XCEK9XripxBKmc: { type: "idle" } }));
        return;
      }
      if (
        req.method === "PATCH" &&
        req.url?.startsWith("/session/ses_f94cdc23a1e7XCEK9XripxBKmc")
      ) {
        res.end(
          JSON.stringify({
            id: "ses_f94cdc23a1e7XCEK9XripxBKmc",
            title: "Preferred parent",
            directory: workspacePath,
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      if (
        req.method === "POST" &&
        req.url?.startsWith("/session/ses_f94cdc23a1e7XCEK9XripxBKmc/message")
      ) {
        res.end(JSON.stringify({ info: { id: "msg_jarvis_pref" }, parts: [] }));
        return;
      }
      if (req.method === "POST" && req.url?.startsWith("/session")) {
        const url = new URL(req.url, "http://opencode.test");
        workspacePath = url.searchParams.get("directory");
        res.end(
          JSON.stringify({
            id: "ses_f94cdc23a1e7XCEK9XripxBKmc",
            title: "New session",
            directory: workspacePath,
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      res.end(JSON.stringify({}));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const settingsResponse = await settingsPatchRequest({
        preferredJarvisParentPath: preferredParent,
      });
      expect(settingsResponse.status).toBe(200);
      expect(await settingsResponse.json()).toMatchObject({
        preferredJarvisParentPath: preferredParent,
      });

      const response = await jarvisSessionRequest("the jarvis", await ensureJarvisSpace());
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(workspacePath).toBe(path.join(preferredParent, "the-jarvis"));
      expect(payload.session).toMatchObject({
        id: "ses_f94cdc23a1e7XCEK9XripxBKmc",
        opencodeDirectory: workspacePath,
      });
      expect(existsSync(path.join(workspacePath!, "AGENTS.md"))).toBe(true);
    } finally {
      await settingsPatchRequest({ preferredJarvisParentPath: null });
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      rmSync(preferredParent, { recursive: true, force: true });
      server.close();
    }
  });

  it("does not overwrite existing files when applying the Jarvis template", async () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "say-to-me-jarvis-template-"));
    try {
      writeFileSync(path.join(workspacePath, "AGENTS.md"), "custom instructions");
      materializeJarvisTemplate(workspacePath);

      expect(readFileSync(path.join(workspacePath, "AGENTS.md"), "utf8")).toBe(
        "custom instructions",
      );
      expect(existsSync(path.join(workspacePath, "bootstrap-message.md"))).toBe(true);
      expect(existsSync(path.join(workspacePath, "sessions.md"))).toBe(true);
      expect(existsSync(path.join(workspacePath, "tasks.md"))).toBe(true);
      expect(existsSync(path.join(workspacePath, "artifacts.md"))).toBe(true);
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("compensates filesystem work when OpenCode session creation fails", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    let workspacePath: string | null = null;
    const openCode = await mockOpenCode((req, res) => {
      if (req.method === "POST" && req.url?.startsWith("/session")) {
        const url = new URL(req.url, "http://opencode.test");
        workspacePath = url.searchParams.get("directory");
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "session unavailable" }));
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await jarvisSessionRequest("Partial setup", await ensureJarvisSpace());
      const payload = await response.json();

      expect(response.status).toBe(503);
      expect(payload.error).toMatch(/OpenCode|503/i);
      if (workspacePath) {
        expect(existsSync(workspacePath)).toBe(false);
      }
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      if (workspacePath) rmSync(workspacePath, { recursive: true, force: true });
      server.close();
    }
  });

  it("keeps the created Jarvis session when OpenCode naming fails after creation", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    let workspacePath: string | null = null;
    const openCode = await mockOpenCode((req, res) => {
      if (
        req.method === "PATCH" &&
        req.url?.startsWith("/session/ses_5e45ba4389d3LLprgC7elZNfy4")
      ) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "title unavailable" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_5e45ba4389d3LLprgC7elZNfy4: { type: "idle" } }));
        return;
      }
      if (req.method === "POST" && req.url?.startsWith("/session")) {
        const url = new URL(req.url, "http://opencode.test");
        workspacePath = url.searchParams.get("directory");
      }
      if (req.method === "POST" && req.url?.includes("/message")) {
        res.end(JSON.stringify({ info: { id: "msg_boot" }, parts: [] }));
        return;
      }
      res.end(
        JSON.stringify({
          id: "ses_5e45ba4389d3LLprgC7elZNfy4",
          title: "New session",
          directory: workspacePath,
          time: { created: 1, updated: 2 },
        }),
      );
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await jarvisSessionRequest("Name should fail", await ensureJarvisSpace());
      const payload = await response.json();

      expect(response.status).toBe(201);
      expect(payload.session).toMatchObject({
        id: "ses_5e45ba4389d3LLprgC7elZNfy4",
        state: "jarvis",
        opencodeDirectory: workspacePath,
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      if (workspacePath) rmSync(workspacePath, { recursive: true, force: true });
      server.close();
    }
  });

  it("surfaces OpenCode agent and model dynamically from session info", async () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "say-to-me-opencode-agent-"));
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/project/current")) {
        res.end(
          JSON.stringify({
            id: "prj_agent",
            worktree: workspacePath,
            vcs: "git",
            name: "sample-project",
            sandboxes: [],
            time: { created: 1, updated: 2 },
          }),
        );
        return;
      }
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_332741559a99G6XsOIv6KHeqwd: { type: "idle" } }));
        return;
      }
      res.end(
        JSON.stringify({
          id: "ses_332741559a99G6XsOIv6KHeqwd",
          slug: "agent-model",
          title: "agent model session",
          directory: workspacePath,
          projectID: "prj_agent",
          agent: "build",
          model: { id: "fast-model", providerID: "local" },
          version: "1.0.0",
          time: { created: 1, updated: 2 },
        }),
      );
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const createdResponse = await fetch(`${origin}/api/opencode-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workspacePath }),
      });
      const createdPayload = await createdResponse.json();

      expect(createdResponse.status).toBe(201);
      expect(createdPayload.session).toMatchObject({
        id: "ses_332741559a99G6XsOIv6KHeqwd",
        opencodeAgent: "build",
        opencodeModelProvider: "local",
        opencodeModel: "fast-model",
      });

      process.env.SAY_TO_ME_OPENCODE_URL = "http://127.0.0.1:1";
      const list = await fetch(`${origin}/api/sessions`).then((r) => r.json());
      const stored = list.sessions.find(
        (s: ApiSession) => s.id === "ses_332741559a99G6XsOIv6KHeqwd",
      );
      expect(stored).toMatchObject({
        opencodeAgent: "build",
        opencodeModelProvider: "local",
        opencodeModel: "fast-model",
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      rmSync(workspacePath, { recursive: true, force: true });
      server.close();
    }
  });

  it("preserves public OpenCode session creation error responses", async () => {
    const workspacePath = path.join(tmpdir(), `say-to-me-session-http-file-${Date.now()}`);
    writeFileSync(workspacePath, "not a directory");
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((_req, res) => {
      res.writeHead(418, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "teapot" }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const validationResponse = await fetch(`${origin}/api/opencode-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workspacePath }),
      });
      await expect(validationResponse.json()).resolves.toEqual({
        error: "Path must exist and be a writable directory.",
        status: 400,
      });
      expect(validationResponse.status).toBe(400);

      const validWorkspacePath = mkdtempSync(path.join(tmpdir(), "say-to-me-session-http-"));
      try {
        const upstreamResponse = await fetch(`${origin}/api/opencode-sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: validWorkspacePath }),
        });
        await expect(upstreamResponse.json()).resolves.toEqual({
          error: "OpenCode returned HTTP 418",
          status: 418,
        });
        expect(upstreamResponse.status).toBe(418);
      } finally {
        rmSync(validWorkspacePath, { recursive: true, force: true });
      }
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      rmSync(workspacePath, { force: true });
      server.close();
    }
  });
});
