import { beforeEach, describe, expect, it } from "vite-plus/test";
import type { ApiMessage } from "./api.harness.ts";

const { clearQueue, createTestRequest, createTestSession, expectHandledResponse } =
  await import("./api.harness.ts");
const { dispatchEffectApiRequest } = await import("./api-routes/effect-api.ts");

function request(path: string, init?: RequestInit) {
  const testRequest = createTestRequest(path, init);
  return dispatchEffectApiRequest(testRequest).then((response) =>
    expectHandledResponse(response, testRequest),
  );
}

describe("say API: messages core (direct dispatch)", () => {
  beforeEach(async () => {
    await clearQueue("");
  });

  it("registers message and queue routes in the Effect route table", async () => {
    expect(
      await dispatchEffectApiRequest(createTestRequest("/say", { method: "POST" })),
    ).not.toBeNull();
    expect(await dispatchEffectApiRequest(createTestRequest("/api/queue"))).not.toBeNull();
    expect(await dispatchEffectApiRequest(createTestRequest("/api/capabilities"))).not.toBeNull();
    expect(await dispatchEffectApiRequest(createTestRequest("/api/otel-config"))).not.toBeNull();
    expect(await dispatchEffectApiRequest(createTestRequest("/api/version"))).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        createTestRequest("/api/sessions/ses_e690efb7bd16APySy1k11Sn0Vi/messages"),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        createTestRequest("/api/sessions/ses_e690efb7bd16APySy1k11Sn0Vi/messages", {
          method: "POST",
        }),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        createTestRequest("/api/messages/1/replies", { method: "POST" }),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        createTestRequest("/api/messages/1/retry-opencode", { method: "POST" }),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        createTestRequest("/api/messages/1/session", { method: "POST" }),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        createTestRequest("/api/messages/1/status", { method: "POST" }),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(createTestRequest("/api/messages/1/pin", { method: "POST" })),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(createTestRequest("/api/messages/1", { method: "DELETE" })),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(createTestRequest("/api/messages/1/agent-events")),
    ).toBeNull();
    expect(
      await dispatchEffectApiRequest(createTestRequest("/api/uploads/image", { method: "POST" })),
    ).not.toBeNull();
  });

  it("stores submitted text in FIFO order", async () => {
    const first = await request("/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "first" }),
    });
    const second = await request("/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "second" }),
    });
    const queue = await request("/api/queue").then((response) => response.json());

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(queue.messages.map((message: ApiMessage) => message.text)).toEqual(["first", "second"]);
  });

  it("validates message length and queue limits", async () => {
    const tooLong = await request("/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(257) }),
    });
    await createTestSession("ses_e7f490b77a3dV8AbtywFoMQvWS");
    const longUser = await request("/api/sessions/ses_e7f490b77a3dV8AbtywFoMQvWS/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "user", text: "x".repeat(257) }),
    });
    await createTestSession("ses_6698becca44f3Q7XMGKwyJKcGO");
    const longExtraMarkdown = await request(
      "/api/sessions/ses_6698becca44f3Q7XMGKwyJKcGO/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          extraMarkdown: "x".repeat(257),
          text: "allowed text",
        }),
      },
    );
    await request("/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "one" }),
    });
    await request("/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "two" }),
    });
    const tooShort = await request("/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x" }),
    });
    const tooMany = await request("/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "third" }),
    });
    const queue = await request("/api/queue").then((response) => response.json());

    expect(tooShort.status).toBe(400);
    expect(await tooShort.json()).toMatchObject({ error: expect.stringContaining("too short") });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ error: expect.stringContaining("too long") });
    expect(longUser.status).toBe(201);
    expect(longExtraMarkdown.status).toBe(400);
    expect(await longExtraMarkdown.json()).toMatchObject({
      error: expect.stringContaining("too long"),
    });
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toMatchObject({
      error: expect.stringContaining('Pass "overflow":"force"'),
    });
    expect(queue).not.toHaveProperty("dbPath");
  });
});
