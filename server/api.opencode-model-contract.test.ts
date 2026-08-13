import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";

const {
  clearQueue,
  closeTestServer,
  createTestRequest,
  expectHandledResponse,
  mockOpenCode,
  teardownApi,
  waitFor,
} = await import("./api.harness.ts");
const { dispatchEffectApiRequest } = await import("./api-routes/effect-api.ts");

const sessionId = "ses_1dd864100ffes6uqv2NbJatAKt";

function request(path: string, init?: RequestInit) {
  const testRequest = createTestRequest(path, init);
  return dispatchEffectApiRequest(testRequest).then((response) =>
    expectHandledResponse(response, testRequest),
  );
}

describe("OpenCode model selection direct API contract", () => {
  beforeEach(async () => {
    await clearQueue("");
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("uses the selected model and reasoning effort when delivering a message", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/config/providers")) {
        res.end(
          JSON.stringify({
            providers: [
              {
                id: "github-copilot",
                name: "GitHub Copilot",
                source: "api",
                env: [],
                options: {},
                models: {
                  "gpt-5.5": {
                    id: "gpt-5.5",
                    providerID: "github-copilot",
                    name: "GPT-5.5",
                    status: "active",
                    options: { reasoningEffort: ["low", "high"] },
                  },
                },
              },
            ],
            default: { "github-copilot": "gpt-5.5" },
          }),
        );
        return;
      }
      if (req.method === "GET" && req.url?.startsWith(`/session/${sessionId}`)) {
        res.end(
          JSON.stringify({
            id: sessionId,
            directory: "/repo",
            model: { providerID: "github-copilot", id: "gpt-5.5", variant: null },
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sessionId}/message`)) {
        res.end(JSON.stringify({ info: { id: "msg_model" }, parts: [] }));
        return;
      }
      res.end(JSON.stringify({}));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      // This is the dedicated OpenCode controls route. `/models` remains the unified frontend route.
      const listed = await request(`/api/sessions/${sessionId}/opencode-models`);
      expect(listed.status).toBe(200);
      await expect(listed.json()).resolves.toEqual({
        models: [
          {
            providerID: "github-copilot",
            id: "gpt-5.5",
            name: "GPT-5.5",
            reasoningEfforts: ["low", "high"],
          },
        ],
      });

      const selected = await request(`/api/sessions/${sessionId}/opencode-model`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: "github-copilot", modelID: "gpt-5.5" }),
      });
      expect(selected.status).toBe(200);
      await expect(selected.json()).resolves.toMatchObject({
        session: {
          opencodeSelectedModelProvider: "github-copilot",
          opencodeSelectedModel: "gpt-5.5",
        },
      });

      const effort = await request(`/api/sessions/${sessionId}/opencode-reasoning-effort`);
      expect(effort.status).toBe(200);
      await expect(effort.json()).resolves.toEqual({
        available: ["low", "high"],
        selected: null,
        current: null,
      });

      const updatedEffort = await request(`/api/sessions/${sessionId}/opencode-reasoning-effort`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effort: "high" }),
      });
      expect(updatedEffort.status).toBe(200);
      await expect(updatedEffort.json()).resolves.toEqual({
        available: ["low", "high"],
        selected: "high",
        current: "high",
      });

      const delivered = await request(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", text: "use selected model" }),
      });
      expect(delivered.status).toBe(201);

      let promptRequest: (typeof openCode.requests)[number] | undefined;
      await waitFor(() => {
        promptRequest = openCode.requests.find(
          (candidate) =>
            candidate.method === "POST" && candidate.url === `/session/${sessionId}/message`,
        );
        return promptRequest != null;
      });
      expect(promptRequest?.body).toMatchObject({
        model: { providerID: "github-copilot", modelID: "gpt-5.5" },
        variant: "high",
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      await closeTestServer(openCode.server);
    }
  });

  it("preserves the direct public model-control 400 and 502 status/error responses", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "model list failed" }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const invalidSelection = await request(`/api/sessions/${sessionId}/opencode-model`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerID: "", modelID: "gpt-5.5" }),
      });
      expect(invalidSelection.status).toBe(400);
      await expect(invalidSelection.json()).resolves.toEqual({ error: "Model is required." });

      const upstreamList = await request(`/api/sessions/${sessionId}/opencode-models`);
      expect(upstreamList.status).toBe(502);
      await expect(upstreamList.json()).resolves.toEqual({ error: "OpenCode returned HTTP 500" });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      await closeTestServer(openCode.server);
    }
  });
});
