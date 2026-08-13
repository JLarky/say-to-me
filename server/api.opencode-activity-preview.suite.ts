import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type TestServer,
  clearQueue,
  createApiMiddleware,
  listen,
  mockOpenCode,
} from "./api.harness.ts";

describe("say API: OpenCode activity preview", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  it("registers OpenCode activity preview routes by default", async () => {
    try {
      const response = await fetch(
        `${origin}/api/debug/opencode-activity/ses_39c4eb0eca22SDhlgf01U2620a`,
      );

      expect(response.status).not.toBe(404);
    } finally {
      server.close();
    }
  });

  it("preserves markdown line structure in the activity preview snippet", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_832457b73feakX38H8scompII8";
    const markdown = "| Library | Role |\n|---|---|\n| marked | parser |";
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.startsWith("/session/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ [sessionId]: { type: "idle" } }));
        return;
      }
      if (req.url?.startsWith(`/session/${sessionId}/message`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              info: {
                id: "msg_markdown",
                role: "assistant",
                time: { created: Date.now(), completed: Date.now() },
              },
              parts: [{ id: "part_markdown", type: "text", text: markdown }],
            },
          ]),
        );
        return;
      }
      if (req.url?.startsWith(`/session/${sessionId}`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: sessionId, directory: "/tmp/project" }));
        return;
      }
      if (req.url?.startsWith(`/api/session/${sessionId}/message`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: [{ text: markdown }] }));
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const activity = await fetch(`${origin}/api/debug/opencode-activity/${sessionId}`).then(
        (response) => response.json(),
      );

      expect(activity.latestOutputSnippet).toBe(markdown);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("surfaces latest OpenCode message token total with the active model context limit", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_9dd0e37709acUEbZH4UglxV3ko";
    let legacyMessagesRequestedDesc = false;
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.startsWith("/session/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ [sessionId]: { type: "idle" } }));
        return;
      }
      if (req.url?.startsWith(`/session/${sessionId}/message`)) {
        legacyMessagesRequestedDesc = req.url.includes("order=desc");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              info: {
                id: "msg_old",
                role: "assistant",
                time: { created: 100, completed: 200 },
                tokens: { total: 80_000, input: 500, output: 20, cache: { read: 79_480 } },
              },
              parts: [],
            },
            {
              info: {
                id: "msg_latest",
                role: "assistant",
                time: { created: 300, completed: 400 },
                tokens: { total: 119_119, input: 1_803, output: 68, cache: { read: 117_248 } },
              },
              parts: [],
            },
          ]),
        );
        return;
      }
      if (req.url?.startsWith(`/session/${sessionId}`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: sessionId,
            directory: "/tmp/project",
            tokens: { input: 3_205_343, output: 44_548, reasoning: 8_015 },
            model: { id: "gpt-5.5", providerID: "openai", variant: "default" },
          }),
        );
        return;
      }
      if (req.url?.startsWith(`/api/session/${sessionId}/message`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: [] }));
        return;
      }
      if (req.url?.startsWith("/api/model")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              {
                id: "gpt-5.5",
                providerID: "openai",
                limit: { context: 1_050_000, input: 922_000, output: 128_000 },
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const activity = await fetch(`${origin}/api/debug/opencode-activity/${sessionId}`).then(
        (response) => response.json(),
      );

      expect(activity.contextUsage).toEqual({
        usedTokens: 119_119,
        limitTokens: 1_050_000,
        percent: 11.3,
        source: "latestMessageTokens",
      });
      expect(legacyMessagesRequestedDesc).toBe(true);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("combines multiple assistant text parts in the activity preview snippet", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_837dce436d8f3roRrgGCgnFdfX";
    const first = "I’ll answer directly from the coordination record.";
    const second = "Worker 1 created old PR #275, so it stayed open.";
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.startsWith("/session/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ [sessionId]: { type: "idle" } }));
        return;
      }
      if (req.url?.startsWith(`/session/${sessionId}/message`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              info: {
                id: "msg_multi_text",
                role: "assistant",
                time: { created: Date.now(), completed: Date.now() },
              },
              parts: [
                { id: "part_start", type: "step-start" },
                { id: "part_first", type: "text", text: first },
                { id: "part_second", type: "text", text: second },
                { id: "part_finish", type: "step-finish" },
              ],
            },
          ]),
        );
        return;
      }
      if (req.url?.startsWith(`/session/${sessionId}`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: sessionId, directory: "/tmp/project" }));
        return;
      }
      if (req.url?.startsWith(`/api/session/${sessionId}/message`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: [] }));
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const activity = await fetch(`${origin}/api/debug/opencode-activity/${sessionId}`).then(
        (response) => response.json(),
      );

      expect(activity.latestOutputSnippet).toBe(`${first}\n\n${second}`);
      expect(activity.recentItems[0]).toMatchObject({
        messageId: "msg_multi_text",
        partId: "part_first",
        snippet: `${first}\n\n${second}`,
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("preserves full long activity preview snippets", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_90ecc195ad0faPS7l1mrcAFB35";
    const longSummary = `${"Long summary line. ".repeat(30)}Final cell content.`;
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.startsWith("/session/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ [sessionId]: { type: "idle" } }));
        return;
      }
      if (req.url?.startsWith(`/session/${sessionId}/message`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              info: {
                id: "msg_long",
                role: "assistant",
                time: { created: Date.now(), completed: Date.now() },
              },
              parts: [{ id: "part_long", type: "text", text: longSummary }],
            },
          ]),
        );
        return;
      }
      if (req.url?.startsWith(`/session/${sessionId}`)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: sessionId, directory: "/tmp/project" }));
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const activity = await fetch(`${origin}/api/debug/opencode-activity/${sessionId}`).then(
        (response) => response.json(),
      );

      expect(activity.latestOutputSnippet).toBe(longSummary);
      expect(activity.latestOutputSnippet).toContain("Final cell content.");
      expect(activity.latestOutputSnippet).not.toContain("...");
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("uses the OpenCode session directory when fetching activity preview", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionId = "ses_c2d0ad9882e96tU4i9vkB16EML";
    const sessionDirectory = "/tmp/activity-project";
    const requestedDirectories: string[] = [];
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.startsWith(`/session/${sessionId}`)) {
        requestedDirectories.push(
          new URL(req.url, openCode.url).searchParams.get("directory") || "",
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: sessionId, directory: sessionDirectory }));
        return;
      }
      if (
        req.url?.startsWith("/session/status") ||
        req.url?.startsWith(`/api/session/${sessionId}/message`) ||
        req.url?.startsWith(`/session/${sessionId}/message`)
      ) {
        requestedDirectories.push(
          new URL(req.url, openCode.url).searchParams.get("directory") || "",
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(req.url?.startsWith("/session/status") ? JSON.stringify({}) : JSON.stringify([]));
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await fetch(`${origin}/api/debug/opencode-activity/${sessionId}`).then((response) =>
        response.json(),
      );

      expect(requestedDirectories).toContain(sessionDirectory);
      expect(
        requestedDirectories.filter(Boolean).every((value) => value === sessionDirectory),
      ).toBe(true);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });
});
