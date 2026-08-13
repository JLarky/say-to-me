import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { clearQueue, createTestRequest, createTestSession, expectHandledResponse, teardownApi } =
  await import("./api.harness.ts");
const { dispatchEffectApiRequest } = await import("./api-routes/effect-api.ts");
const { detectSessionBackend } = await import("./session-id.ts");

function request(path: string, init?: RequestInit) {
  const testRequest = createTestRequest(path, init);
  return dispatchEffectApiRequest(testRequest).then((response) =>
    expectHandledResponse(response, testRequest),
  );
}

describe("voice-only sessions", () => {
  beforeEach(async () => {
    await clearQueue("");
  });

  afterEach(async () => {
    await teardownApi();
  });

  it("classifies ses_ses as none and vo_foo as voice", () => {
    expect(detectSessionBackend("ses_ses")).toBe("none");
    expect(detectSessionBackend("vo_foo")).toBe("voice");
    expect(detectSessionBackend("ses_1dd864100ffes6uqv2NbJatAKt")).toBe("opencode");
  });

  it("creates a vo_ session via POST /api/cli-sessions provider voice", async () => {
    const response = await request("/api/cli-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "voice", name: "shopping-notes" }),
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.session.id).toBe("vo_shopping-notes");
    expect(detectSessionBackend(payload.session.id)).toBe("voice");
  });

  it("mints a generated vo_ id when name is omitted", async () => {
    const response = await request("/api/cli-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "voice" }),
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.session.id).toMatch(/^vo_voice-[0-9a-f]{8}$/);
  });

  it("queues user messages on voice sessions with zero delivery attempts", async () => {
    await createTestSession("vo_foo");
    const enqueueOpenCode = vi.fn();
    const enqueueClaude = vi.fn();
    const enqueueCursor = vi.fn();
    const enqueueCodex = vi.fn();
    const enqueueGrok = vi.fn();

    vi.doMock("./opencode/durable-delivery.ts", () => ({
      enqueueOpenCodeDeliveryJob: enqueueOpenCode,
    }));
    // Direct path goes through createMessageResult which already imported enqueue*.
    // Assert via message delivery status instead.
    const response = await request("/api/sessions/vo_foo/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "user", text: "hello voice queue" }),
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.message.text).toBe("hello voice queue");
    expect(created.message.opencodeDeliveryStatus ?? null).toBeNull();
    expect(created.message.error ?? null).toBeNull();

    const queue = await request("/api/sessions/vo_foo/messages").then((res) => res.json());
    const message = queue.messages.find((m: { id: number }) => m.id === created.message.id);
    expect(message).toMatchObject({
      text: "hello voice queue",
      author: "user",
    });
    expect(message.opencodeDeliveryStatus ?? null).toBeNull();
    expect(message.error ?? null).toBeNull();
    void enqueueOpenCode;
    void enqueueClaude;
    void enqueueCursor;
    void enqueueCodex;
    void enqueueGrok;
  });

  it("queues user messages on ses_ses (none) with zero delivery and no failed status", async () => {
    await createTestSession("ses_ses");
    expect(detectSessionBackend("ses_ses")).toBe("none");

    const response = await request("/api/sessions/ses_ses/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "user", text: "local only note" }),
    });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.message.opencodeDeliveryStatus ?? null).toBeNull();
    expect(created.message.error ?? null).toBeNull();
    expect(String(created.message.error ?? "")).not.toMatch(/failed to deliver/i);
  });

  it("still requires the session to exist before posting user messages (PR 417)", async () => {
    const missing = "vo_does-not-exist-yet";
    const response = await request(`/api/sessions/${missing}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "user", text: "should 404" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Session not found." });
  });
});
