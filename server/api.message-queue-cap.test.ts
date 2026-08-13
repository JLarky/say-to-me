import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import {
  type ApiMessage,
  type TestServer,
  beginTestTransaction,
  clearQueue,
  commitTestTransaction,
  createApiMiddleware,
  createTestSession,
  listen,
  teardownApi,
  tinyPng,
} from "./api.harness.ts";
import { dispatchEffectApiRequest } from "./api-routes/effect-api.ts";
import { dbPath } from "./config.ts";
import { getQueuedCountForSession } from "./messages.ts";
import {
  resetQueueCapClaimDepsForTest,
  setQueueCapClaimDepsForTest,
} from "./messages-queue-cap-claim.ts";
import { clearForwardCompletionNotificationWatches } from "./notifications.ts";
import { opencodeStatusCache } from "./opencode/cache.ts";
import { stopAllCompletionWatches } from "./opencode/completion-watch.ts";

type ClaimWorkerResult =
  | { ok: true; messageId: number; existing: boolean }
  | { ok: false; error: string };

function claimOnSecondConnection(input: {
  sessionId: string;
  text: string;
  overflow: "force" | null;
  clientMessageId?: string | null;
  cap?: number;
}): Promise<ClaimWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      fileURLToPath(new URL("./messages-queue-cap-claim-worker.ts", import.meta.url)),
      {
        execArgv: ["--experimental-strip-types"],
        workerData: {
          dbPath,
          cap: input.cap ?? Number(process.env.SAY_TO_ME_MAX_QUEUED_MESSAGES || 2),
          sessionId: input.sessionId,
          text: input.text,
          overflow: input.overflow,
          clientMessageId: input.clientMessageId ?? null,
        },
      },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error("queue-cap claim worker timed out"));
    }, 15_000);
    worker.on("message", (message: ClaimWorkerResult) => {
      clearTimeout(timer);
      resolve(message);
    });
    worker.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new Error(`queue-cap claim worker exited with code ${code}`));
      }
    });
  });
}

describe("say API: per-session agent queue cap", () => {
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
    resetQueueCapClaimDepsForTest();
  });

  afterAll(async () => {
    await teardownApi();
  });

  async function postAgent(
    sessionId: string,
    text: string,
    extra?: { overflow?: string },
  ): Promise<Response> {
    return fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "agent", text, ...extra }),
    });
  }

  async function postUser(sessionId: string, text: string): Promise<Response> {
    return fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "user", text }),
    });
  }

  async function pinMessage(messageId: number): Promise<void> {
    const response = await fetch(`${origin}/api/messages/${messageId}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(response.status).toBe(200);
  }

  async function listMessages(sessionId: string): Promise<ApiMessage[]> {
    const queue = await fetch(
      `${origin}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    ).then((response) => response.json());
    return queue.messages;
  }

  it("rejects agent POST at the per-session cap with 400 and overflow guidance", async () => {
    // Harness sets SAY_TO_ME_MAX_QUEUED_MESSAGES=2.
    await createTestSession("ses_e850f4364e31k78seUE7DpaqrA");
    expect((await postAgent("ses_e850f4364e31k78seUE7DpaqrA", "one")).status).toBe(201);
    expect((await postAgent("ses_e850f4364e31k78seUE7DpaqrA", "two")).status).toBe(201);
    const blocked = await postAgent("ses_e850f4364e31k78seUE7DpaqrA", "three");
    expect(blocked.status).toBe(400);
    const body = await blocked.json();
    expect(body.error).toContain("Session queue is full");
    expect(body.error).toContain('Pass "overflow":"force"');
    expect(body.error).toContain("2 queued messages");
  });

  it("isolates the cap per session so a full session A does not block session B", async () => {
    await createTestSession("ses_9b0c4a599efeAtKTnQ7F00G0MF");
    await createTestSession("ses_9110dfe7a2censSRQyf68RjrXg");
    expect((await postAgent("ses_9b0c4a599efeAtKTnQ7F00G0MF", "a1")).status).toBe(201);
    expect((await postAgent("ses_9b0c4a599efeAtKTnQ7F00G0MF", "a2")).status).toBe(201);
    expect((await postAgent("ses_9b0c4a599efeAtKTnQ7F00G0MF", "a3")).status).toBe(400);
    const bOk = await postAgent("ses_9110dfe7a2censSRQyf68RjrXg", "b1");
    expect(bOk.status).toBe(201);
  });

  it("still accepts user messages when the session agent queue is at the cap", async () => {
    await createTestSession("ses_2b0613e53f14AbGpcJmgSf42DZ");
    expect((await postAgent("ses_2b0613e53f14AbGpcJmgSf42DZ", "one")).status).toBe(201);
    expect((await postAgent("ses_2b0613e53f14AbGpcJmgSf42DZ", "two")).status).toBe(201);
    const userOk = await postUser("ses_2b0613e53f14AbGpcJmgSf42DZ", "user still ok");
    expect(userOk.status).toBe(201);
  });

  it("overflow force skips the oldest non-pinned queued message and accepts the new one", async () => {
    await createTestSession("ses_0b5ca9eaba257XNDAwGMEvToSx");
    const first = await postAgent("ses_0b5ca9eaba257XNDAwGMEvToSx", "oldest");
    const second = await postAgent("ses_0b5ca9eaba257XNDAwGMEvToSx", "newer");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = ((await first.json()) as { message: ApiMessage }).message.id;
    const secondId = ((await second.json()) as { message: ApiMessage }).message.id;
    await pinMessage(secondId);

    const forced = await postAgent("ses_0b5ca9eaba257XNDAwGMEvToSx", "replacement", {
      overflow: "force",
    });
    expect(forced.status).toBe(201);
    const newId = ((await forced.json()) as { message: ApiMessage }).message.id;

    const messages = await listMessages("ses_0b5ca9eaba257XNDAwGMEvToSx");
    const byId = new Map(messages.map((message) => [message.id, message]));
    expect(byId.get(firstId)?.status).toBe("skipped");
    expect(byId.get(secondId)?.status).toBe("queued");
    expect(byId.get(secondId)?.pinned).toBeTruthy();
    expect(byId.get(newId)?.status).toBe("queued");
    expect(byId.get(newId)?.text).toBe("replacement");
    expect(messages.filter((message) => message.status === "queued")).toHaveLength(2);
  });

  it("returns 400 when overflow force is used but every queued message is pinned", async () => {
    await createTestSession("ses_72443b916394SgiVI2hz34kBqC");
    const first = await postAgent("ses_72443b916394SgiVI2hz34kBqC", "pin-one");
    const second = await postAgent("ses_72443b916394SgiVI2hz34kBqC", "pin-two");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await pinMessage(((await first.json()) as { message: ApiMessage }).message.id);
    await pinMessage(((await second.json()) as { message: ApiMessage }).message.id);

    const forced = await postAgent("ses_72443b916394SgiVI2hz34kBqC", "no-room", {
      overflow: "force",
    });
    expect(forced.status).toBe(400);
    const body = await forced.json();
    expect(body.error).toContain("All queued messages are pinned");
  });

  it("ignores overflow force when the session is under the cap", async () => {
    await createTestSession("ses_87d846ffc9caIbmczEM2xpNJH9");
    const ok = await postAgent("ses_87d846ffc9caIbmczEM2xpNJH9", "only one", { overflow: "force" });
    expect(ok.status).toBe(201);
    const messages = await listMessages("ses_87d846ffc9caIbmczEM2xpNJH9");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe("queued");
    expect(messages[0]?.text).toBe("only one");
  });

  it("never evicts a queued root whose only pin is on a reply", async () => {
    await createTestSession("ses_9aef2000464f9gMp3eHt4sUwsS");
    const first = await postAgent("ses_9aef2000464f9gMp3eHt4sUwsS", "protected by reply pin");
    const second = await postAgent("ses_9aef2000464f9gMp3eHt4sUwsS", "also queued");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = ((await first.json()) as { message: ApiMessage }).message.id;
    const secondId = ((await second.json()) as { message: ApiMessage }).message.id;

    const reply = await fetch(`${origin}/api/messages/${firstId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "pin me" }),
    }).then((response) => response.json());
    await pinMessage(reply.message.id);

    const forced = await postAgent("ses_9aef2000464f9gMp3eHt4sUwsS", "replacement", {
      overflow: "force",
    });
    expect(forced.status).toBe(201);
    const newId = ((await forced.json()) as { message: ApiMessage }).message.id;

    const messages = await listMessages("ses_9aef2000464f9gMp3eHt4sUwsS");
    const byId = new Map(messages.map((message) => [message.id, message]));
    expect(byId.get(firstId)?.status).toBe("queued");
    expect(byId.get(secondId)?.status).toBe("skipped");
    expect(byId.get(newId)?.status).toBe("queued");
    expect(
      messages.filter((message) => message.status === "queued" && message.author === "agent"),
    ).toHaveLength(2);
  });

  it("returns 400 when force cannot evict because every queued root is protected by pin or pinned reply", async () => {
    await createTestSession("ses_9ed4ea46d24bc05QVn1JD7qlkt");
    const first = await postAgent("ses_9ed4ea46d24bc05QVn1JD7qlkt", "root pin");
    const second = await postAgent("ses_9ed4ea46d24bc05QVn1JD7qlkt", "reply pin");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = ((await first.json()) as { message: ApiMessage }).message.id;
    const secondId = ((await second.json()) as { message: ApiMessage }).message.id;
    await pinMessage(firstId);

    const reply = await fetch(`${origin}/api/messages/${secondId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "protects root" }),
    }).then((response) => response.json());
    await pinMessage(reply.message.id);

    const forced = await postAgent("ses_9ed4ea46d24bc05QVn1JD7qlkt", "no-room", {
      overflow: "force",
    });
    expect(forced.status).toBe(400);
    const body = await forced.json();
    expect(body.error).toContain("All queued messages are pinned");
  });

  it("serializes concurrent at-cap sends across two sqlite connections", async () => {
    await createTestSession("ses_af8ec96c8663L1x7jZCkJZL4HN");
    expect((await postAgent("ses_af8ec96c8663L1x7jZCkJZL4HN", "seed")).status).toBe(201);
    // Cap is 2: one slot left. Two connections race to claim it without force.
    // Release the harness BEGIN so worker connections can take BEGIN IMMEDIATE.
    commitTestTransaction();
    try {
      const [a, b] = await Promise.all([
        claimOnSecondConnection({
          sessionId: "ses_af8ec96c8663L1x7jZCkJZL4HN",
          text: "race-a",
          overflow: null,
        }),
        claimOnSecondConnection({
          sessionId: "ses_af8ec96c8663L1x7jZCkJZL4HN",
          text: "race-b",
          overflow: null,
        }),
      ]);
      const outcomes = [a, b];
      expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
      expect(outcomes.filter((result) => !result.ok)).toHaveLength(1);
      expect(getQueuedCountForSession("ses_af8ec96c8663L1x7jZCkJZL4HN")).toBe(2);
    } finally {
      beginTestTransaction();
    }
  }, 20_000);

  it("serializes concurrent force sends across two sqlite connections without double-evicting", async () => {
    await createTestSession("ses_01979ae09e1c37PoJC4TNtoZxY");
    const first = await postAgent("ses_01979ae09e1c37PoJC4TNtoZxY", "oldest");
    const second = await postAgent("ses_01979ae09e1c37PoJC4TNtoZxY", "newer");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = ((await first.json()) as { message: ApiMessage }).message.id;
    const secondId = ((await second.json()) as { message: ApiMessage }).message.id;

    commitTestTransaction();
    try {
      const [a, b] = await Promise.all([
        claimOnSecondConnection({
          sessionId: "ses_01979ae09e1c37PoJC4TNtoZxY",
          text: "force-a",
          overflow: "force",
        }),
        claimOnSecondConnection({
          sessionId: "ses_01979ae09e1c37PoJC4TNtoZxY",
          text: "force-b",
          overflow: "force",
        }),
      ]);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      expect(getQueuedCountForSession("ses_01979ae09e1c37PoJC4TNtoZxY")).toBe(2);

      const messages = await listMessages("ses_01979ae09e1c37PoJC4TNtoZxY");
      const byId = new Map(messages.map((message) => [message.id, message]));
      expect(byId.get(firstId)?.status).toBe("skipped");
      expect(byId.get(secondId)?.status).toBe("skipped");
      expect(messages.filter((message) => message.status === "skipped")).toHaveLength(2);
      expect(
        messages.filter((message) => message.status === "queued" && message.author === "agent"),
      ).toHaveLength(2);
    } finally {
      beginTestTransaction();
    }
  }, 20_000);

  it("serializes concurrent force retries with the same clientMessageId to one insert", async () => {
    await createTestSession("ses_9e68a4853b38COF7rSUhB7EGHi");
    const first = await postAgent("ses_9e68a4853b38COF7rSUhB7EGHi", "oldest");
    const second = await postAgent("ses_9e68a4853b38COF7rSUhB7EGHi", "newer");
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = ((await first.json()) as { message: ApiMessage }).message.id;
    const secondId = ((await second.json()) as { message: ApiMessage }).message.id;
    const clientMessageId = "client-force-idempotent-1";

    commitTestTransaction();
    try {
      const [a, b] = await Promise.all([
        claimOnSecondConnection({
          sessionId: "ses_9e68a4853b38COF7rSUhB7EGHi",
          text: "same-retry",
          overflow: "force",
          clientMessageId,
        }),
        claimOnSecondConnection({
          sessionId: "ses_9e68a4853b38COF7rSUhB7EGHi",
          text: "same-retry",
          overflow: "force",
          clientMessageId,
        }),
      ]);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(a.messageId).toBe(b.messageId);
      expect([a.existing, b.existing].filter(Boolean)).toHaveLength(1);
      expect([a.existing, b.existing].filter((value) => !value)).toHaveLength(1);
      expect(getQueuedCountForSession("ses_9e68a4853b38COF7rSUhB7EGHi")).toBe(2);

      const messages = await listMessages("ses_9e68a4853b38COF7rSUhB7EGHi");
      const byClient = messages.filter((message) => message.clientMessageId === clientMessageId);
      expect(byClient).toHaveLength(1);
      expect(byClient[0]?.text).toBe("same-retry");
      expect(byClient[0]?.status).toBe("queued");

      const byId = new Map(messages.map((message) => [message.id, message]));
      const skippedOriginals = [firstId, secondId].filter(
        (id) => byId.get(id)?.status === "skipped",
      );
      expect(skippedOriginals).toHaveLength(1);
      expect(messages.filter((message) => message.status === "skipped")).toHaveLength(1);
      expect(
        messages.filter((message) => message.status === "queued" && message.author === "agent"),
      ).toHaveLength(2);
    } finally {
      beginTestTransaction();
    }
  }, 20_000);

  it("retries an agent image message by clientMessageId after the temp file is gone", async () => {
    const imagePath = path.join("/tmp", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png");
    writeFileSync(imagePath, tinyPng);
    const sessionId = "ses_912b0bb1b2c9mGNhWFwRdNFrzr";
    const clientMessageId = "client-image-idempotent-1";
    await createTestSession(sessionId);

    const payload = {
      author: "agent",
      text: "shot with image",
      images: [imagePath],
      clientMessageId,
    };
    try {
      const created = await fetch(
        `${origin}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      expect(created.status).toBe(201);
      const createdBody = (await created.json()) as { message: ApiMessage };
      expect(createdBody.message.clientMessageId).toBe(clientMessageId);
      expect(createdBody.message.attachments).toHaveLength(1);

      rmSync(imagePath, { force: true });

      const before = await listMessages(sessionId);
      const retry = await fetch(
        `${origin}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      expect(retry.status).toBe(200);
      const retryBody = (await retry.json()) as { message: ApiMessage };
      expect(retryBody.message.id).toBe(createdBody.message.id);
      expect(retryBody.message.clientMessageId).toBe(clientMessageId);

      const after = await listMessages(sessionId);
      expect(after).toHaveLength(before.length);
      expect(after.filter((message) => message.clientMessageId === clientMessageId)).toHaveLength(
        1,
      );
      expect(getQueuedCountForSession(sessionId)).toBe(1);
    } finally {
      rmSync(imagePath, { force: true });
    }
  });

  it("returns typed 500 when the queue-cap claim throws (not a defect)", async () => {
    await createTestSession("ses_06227d5bc1fciuZdc1BdpD5eMU");
    setQueueCapClaimDepsForTest({
      throwOnClaim: () => {
        throw new Error("simulated queue-cap claim DB failure");
      },
    });
    const response = await dispatchEffectApiRequest(
      new Request("http://say.local/api/sessions/ses_06227d5bc1fciuZdc1BdpD5eMU/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ author: "agent", text: "will fail" }),
      }),
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(500);
    expect(await response!.json()).toEqual({ error: "Unable to create message" });
    expect(getQueuedCountForSession("ses_06227d5bc1fciuZdc1BdpD5eMU")).toBe(0);
  });
});
