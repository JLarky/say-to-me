import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

process.env.SAY_TO_ME_GROK_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_GROK_ECHO_ACCEPT_DELAY_MS = "0";
process.env.SAY_TO_ME_GROK_ECHO_REPLY_DELAY_MS = "50";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("../api.harness.ts");
const { insertMessageRow } = await import("../messages.ts");
const { drizzleDb } = await import("../db/index.ts");
const { grokDeliveryJobs } = await import("../db/drizzle-schema.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { enqueueGrokDeliveryJob } = await import("./durable-delivery.ts");
const { hasExternalCliSessionWork } = await import("../external-cli/cli-session-busy.ts");
const { hasLiveChild, resetLiveChildrenForTests } = await import("../external-cli/live-child.ts");
const { grokDeliveryPrompt, runGrokRestDeliveryOnce } = await import("./rest-delivery-worker.ts");

describe("Grok REST delivery prompt", () => {
  it("includes the isolated CLI origin", () => {
    expect(
      grokDeliveryPrompt(
        { grokSessionId: "gr_abc" },
        { text: "hello" },
        {
          env: { SAY_TO_ME_URL: "http://127.0.0.1:5412" },
          existsSync: () => false,
          readFileSync: () => "",
        },
      ),
    ).toContain("say-to-me api --server http://127.0.0.1:5412");
  });
});

describe("Grok REST delivery worker", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;

  beforeEach(async () => {
    const started = await listen(createApiMiddleware());
    server = started.server;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
    process.env.SAY_TO_ME_GROK_WORKER_MODE = "echo";
  });

  afterEach(async () => {
    resetLiveChildrenForTests();
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    delete process.env.SAY_TO_ME_GROK_WORKER_MODE;
    delete process.env.SAY_TO_ME_GROK_BIN;
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("isolated gate: Stop stays busy after stamping cliTurnEndedAt until the Grok child exits", async () => {
    const sessionId = `gr_${randomUUID()}`;
    const cwd = mkdtempSync(path.join(tmpdir(), "say-to-me-grok-busy-gate-"));
    const provider = path.join(cwd, "grok.sh");
    writeFileSync(
      provider,
      [
        "#!/bin/sh",
        "sleep 2",
        "sleep 8",
        `printf '%s\\n' '${JSON.stringify({ result: "2 minutes" })}'`,
        "",
      ].join("\n"),
    );
    chmodSync(provider, 0o755);
    process.env.SAY_TO_ME_GROK_WORKER_MODE = "grok";
    process.env.SAY_TO_ME_GROK_BIN = provider;
    expect(new URL(process.env.SAY_TO_ME_INTERNAL_URL!).port).not.toBe("5411");
    setSessionCwd(sessionId, cwd);
    const message = insertMessageRow({
      sessionId,
      text: "sleep then reply 2 minutes",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    enqueueGrokDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      grokSessionId: sessionId,
      kind: "direct_user_message",
    });

    const worker = Effect.runPromise(runGrokRestDeliveryOnce("busy-gate", sessionId));
    await expect.poll(() => hasLiveChild(sessionId), { timeout: 15_000 }).toBe(true);

    drizzleDb
      .update(grokDeliveryJobs)
      .set({ cliTurnEndedAt: Date.now() })
      .where(eq(grokDeliveryJobs.messageId, message.id))
      .run();
    expect(hasExternalCliSessionWork(sessionId)).toBe(true);

    await expect(worker).resolves.toBe(true);
    expect(hasExternalCliSessionWork(sessionId)).toBe(false);
  }, 40_000);
});
