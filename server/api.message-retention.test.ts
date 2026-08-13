import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type ApiMessage,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  teardownApi,
  listen,
} from "./api.harness.ts";
import { clearForwardCompletionNotificationWatches } from "./notifications.ts";
import { opencodeStatusCache } from "./opencode/cache.ts";
import { stopAllCompletionWatches } from "./opencode/completion-watch.ts";

describe("say API: message retention and pinning", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    stopAllCompletionWatches();
    clearForwardCompletionNotificationWatches();
    opencodeStatusCache.clear();
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  afterEach(() => {
    server.close();
    stopAllCompletionWatches();
    clearForwardCompletionNotificationWatches();
    opencodeStatusCache.clear();
  });

  afterAll(async () => {
    await teardownApi();
  });

  async function createPlayedMessage(text: string): Promise<ApiMessage> {
    const created = await fetch(`${origin}/say`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then((response) => response.json());
    await fetch(`${origin}/api/messages/${created.message.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "played" }),
    });
    return created.message;
  }

  async function messages(): Promise<ApiMessage[]> {
    const queue = await fetch(`${origin}/api/queue`).then((response) => response.json());
    return queue.messages;
  }

  it("preserves a thread when only its reply is pinned", async () => {
    const root = await createPlayedMessage("pinned by reply");
    const reply = await fetch(`${origin}/api/messages/${root.id}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "important reply" }),
    }).then((response) => response.json());

    const pin = await fetch(`${origin}/api/messages/${reply.message.id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(pin.status).toBe(200);
    expect(await pin.json()).toEqual({ ok: true, pinned: true });

    for (const text of ["one", "two", "three", "four"]) {
      await createPlayedMessage(text);
    }

    expect((await messages()).map((message) => message.text)).toEqual([
      "pinned by reply",
      "important reply",
      "two",
      "three",
      "four",
    ]);
  });

  it("prunes immediately when a pinned root is unpinned", async () => {
    const root = await createPlayedMessage("temporarily important");
    const pin = await fetch(`${origin}/api/messages/${root.id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(pin.status).toBe(200);

    for (const text of ["one", "two", "three"]) {
      await createPlayedMessage(text);
    }

    const unpin = await fetch(`${origin}/api/messages/${root.id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: false }),
    });
    expect(unpin.status).toBe(200);
    expect(await unpin.json()).toEqual({ ok: true, pinned: false });
    expect((await messages()).map((message) => message.text)).toEqual(["one", "two", "three"]);
  });

  it("declares validation and not-found responses for pinning", async () => {
    const invalidPayload = await fetch(`${origin}/api/messages/1/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: "yes" }),
    });
    expect(invalidPayload.status).toBe(400);

    const missingMessage = await fetch(`${origin}/api/messages/999999/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(missingMessage.status).toBe(404);
    expect(await missingMessage.json()).toMatchObject({ error: "Message not found." });
  });
});
