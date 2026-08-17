import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createServer } from "node:http";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { and, eq, gt } from "drizzle-orm";
import { Effect } from "effect";

process.env.SAY_TO_ME_CURSOR_WORKER_AUTOSTART = "0";
process.env.SAY_TO_ME_CURSOR_ECHO_ACCEPT_DELAY_MS = "0";
process.env.SAY_TO_ME_CURSOR_ECHO_REPLY_DELAY_MS = "50";
process.env.SAY_TO_ME_FORWARD_COMPLETION_POLL_MS = "100";

const { closeTestServer, createApiMiddleware, listen, teardownApi } =
  await import("../api.harness.ts");
const { getMessage, insertMessageRow, listMessages } = await import("../messages.ts");
const { getSessionWorkStatus } = await import("../external-cli/session-work-status.ts");
const { hasExternalCliSessionWork } = await import("../external-cli/cli-session-busy.ts");
const { resetLiveChildrenForTests } = await import("../external-cli/live-child.ts");
const { stopIdleNotificationWatch } = await import("../notifications.ts");
const { drizzleDb } = await import("../db/index.ts");
const { cursorDeliveryJobs, messages: messagesTable } = await import("../db/drizzle-schema.ts");
const { setSessionCwd } = await import("../sessions.ts");
const { enqueueCursorDeliveryJob } = await import("./durable-delivery.ts");
const {
  cursorAssistantText,
  cursorCommandArgs,
  cursorDeliveryPrompt,
  parseCursorJsonOutput,
  runCursorRestDeliveryOnce,
} = await import("./rest-delivery-worker.ts");

describe("Cursor REST delivery worker", () => {
  let server: Awaited<ReturnType<typeof listen>>["server"] | null = null;

  beforeEach(async () => {
    const started = await listen(createApiMiddleware());
    server = started.server;
    process.env.SAY_TO_ME_INTERNAL_URL = started.origin;
    process.env.SAY_TO_ME_INTERNAL_API_TOKEN = "test-internal-api-token";
    process.env.SAY_TO_ME_CURSOR_WORKER_MODE = "echo";
  });

  afterEach(async () => {
    resetLiveChildrenForTests();
    if (server) await closeTestServer(server);
    server = null;
    delete process.env.SAY_TO_ME_INTERNAL_URL;
    delete process.env.SAY_TO_ME_CURSOR_WORKER_MODE;
    delete process.env.SAY_TO_ME_CURSOR_BIN;
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("claims and completes a Cursor job through internal REST APIs", async () => {
    const sessionId = `cur_${randomUUID()}`;
    setSessionCwd(sessionId, "/tmp/cursor-rest-worker-test");
    const message = insertMessageRow({
      sessionId,
      text: "rest worker echo",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    // Message ids are reset by the shared test database between runs, while
    // notification watches live in module state.
    stopIdleNotificationWatch(message.id);
    enqueueCursorDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });

    const worked = await Effect.runPromise(
      runCursorRestDeliveryOnce("test-rest-worker", sessionId),
    );

    expect(worked).toBe(true);
    expect(getMessage(message.id)).toMatchObject({ opencodeDeliveryStatus: "sent" });
    // The echo is looked up by session, not by id arithmetic: other tests share
    // the DB and may insert rows between this user message and its reply.
    const replies = drizzleDb
      .select({ extraMarkdown: messagesTable.extraMarkdown })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.sessionId, sessionId),
          eq(messagesTable.author, "agent"),
          gt(messagesTable.id, message.id),
        ),
      )
      .all();
    expect(replies.map((row) => row.extraMarkdown)).toContain(
      `Echo from Cursor worker: ${cursorDeliveryPrompt({ cursorSessionId: sessionId }, message)}`,
    );
  });

  it("retires when claim returns a non-200 response", async () => {
    if (server) await closeTestServer(server);
    server = null;
    const fakeServer = createServer((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "server unavailable" }));
    });
    await new Promise<void>((resolve) => fakeServer.listen(0, "127.0.0.1", resolve));
    const address = fakeServer.address();
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- address is Node's declared `string | AddressInfo | null` Server.address() union; typeof narrows the already-typed union.
    if (!address || typeof address === "string") throw new Error("Expected TCP test server.");
    process.env.SAY_TO_ME_INTERNAL_URL = `http://127.0.0.1:${address.port}`;

    try {
      await expect(
        Effect.runPromise(runCursorRestDeliveryOnce("test-rest-worker", "cur_non200")),
      ).resolves.toBe("stale-worker");
    } finally {
      await closeTestServer(fakeServer);
    }
  });

  it("builds real Cursor print command args with resume and force", () => {
    expect(cursorCommandArgs("1234", "1+1?")).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--resume",
      "1234",
      "--force",
      "1+1?",
    ]);
  });

  it("extracts text from Cursor json output", () => {
    expect(
      parseCursorJsonOutput(
        JSON.stringify({
          type: "result",
          is_error: false,
          result: "2 + 2 = **4**",
        }),
      ),
    ).toEqual({ isError: false, text: "2 + 2 = **4**" });
  });

  it("reads assistant text from stream-json without treating result as done", () => {
    expect(
      cursorAssistantText({
        type: "assistant",
        message: { content: [{ type: "text", text: "STARTING" }] },
      }),
    ).toBe("STARTING");
    expect(
      cursorAssistantText({
        type: "result",
        is_error: false,
        result: "done text is not idle",
      }),
    ).toBeNull();
    expect(
      parseCursorJsonOutput(
        [
          JSON.stringify({
            type: "assistant",
            message: { content: [{ type: "text", text: "STARTING" }] },
          }),
          JSON.stringify({ type: "result", is_error: false, result: "pirate ahoy" }),
        ].join("\n"),
      ),
    ).toEqual({ isError: false, text: "pirate ahoy" });
  });

  it("treats a clean child close as process exit even without a final result", async () => {
    const sessionId = `cur_${randomUUID()}`;
    const cwd = mkdtempSync(path.join(tmpdir(), "say-to-me-cursor-early-close-"));
    const provider = path.join(cwd, "cursor-agent.sh");
    writeFileSync(
      provider,
      '#!/bin/sh\nprintf \'{"type":"assistant","message":{"content":[{"type":"text","text":"still working"}]}}\\n\'\n',
    );
    chmodSync(provider, 0o755);
    process.env.SAY_TO_ME_CURSOR_WORKER_MODE = "cursor";
    process.env.SAY_TO_ME_CURSOR_BIN = provider;
    setSessionCwd(sessionId, cwd);
    const message = insertMessageRow({
      sessionId,
      text: "early close repro",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    enqueueCursorDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });

    await expect(
      Effect.runPromise(runCursorRestDeliveryOnce("early-close", sessionId)),
    ).resolves.toBe(true);
    expect(getMessage(message.id)).toMatchObject({ opencodeDeliveryStatus: "sent" });
    expect(listMessages(sessionId).some((row) => row.text === "still working")).toBe(true);
    expect(await getSessionWorkStatus(sessionId)).toBe("idle");
    expect(
      listMessages(sessionId).filter((row) => row.text === "Session is now idle."),
    ).toHaveLength(1);
  });

  it("isolated gate: no idle during a 2 minute quiet Cursor child, exactly 1 after exit", async () => {
    const sessionId = `cur_${randomUUID()}`;
    const cwd = mkdtempSync(path.join(tmpdir(), "say-to-me-cursor-process-exit-e2e-"));
    const provider = path.join(cwd, "cursor-agent.sh");
    writeFileSync(
      provider,
      [
        "#!/bin/sh",
        "sleep 5",
        `printf '%s\\n' '${JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "5" }] },
        })}'`,
        "sleep 120",
        `printf '%s\\n' '${JSON.stringify({
          type: "result",
          is_error: false,
          result: "2 minutes",
        })}'`,
        "",
      ].join("\n"),
    );
    chmodSync(provider, 0o755);
    process.env.SAY_TO_ME_CURSOR_WORKER_MODE = "cursor";
    process.env.SAY_TO_ME_CURSOR_BIN = provider;
    expect(new URL(process.env.SAY_TO_ME_INTERNAL_URL!).port).not.toBe("5411");
    setSessionCwd(sessionId, cwd);
    const message = insertMessageRow({
      sessionId,
      text: "sleep 5, reply 5, sleep 2 minutes, reply 2 minutes",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    enqueueCursorDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });

    const worker = Effect.runPromise(runCursorRestDeliveryOnce("process-exit-e2e", sessionId));
    await expect
      .poll(
        () => listMessages(sessionId).some((row) => row.author === "agent" && row.text === "5"),
        {
          timeout: 15_000,
        },
      )
      .toBe(true);

    // Simulate every non-authoritative signal saying "idle" while the real
    // provider child is still sleeping. A timer/database implementation
    // would ding here; the process-exit gate must stay silent.
    const activeJob = drizzleDb
      .select()
      .from(cursorDeliveryJobs)
      .where(eq(cursorDeliveryJobs.messageId, message.id))
      .get();
    expect(activeJob).toBeTruthy();
    drizzleDb
      .update(cursorDeliveryJobs)
      .set({ status: "succeeded", cliTurnEndedAt: Date.now(), lockedAt: null, lockedBy: null })
      .where(eq(cursorDeliveryJobs.messageId, message.id))
      .run();
    expect(await getSessionWorkStatus(sessionId)).toBe("idle");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(listMessages(sessionId).filter((row) => row.text === "Session is now idle.")).toEqual(
      [],
    );
    drizzleDb
      .update(cursorDeliveryJobs)
      .set({
        status: "running",
        cliTurnEndedAt: null,
        lockedAt: activeJob!.lockedAt,
        lockedBy: activeJob!.lockedBy,
      })
      .where(eq(cursorDeliveryJobs.messageId, message.id))
      .run();
    expect(await getSessionWorkStatus(sessionId)).toBe("pending");

    await expect(worker).resolves.toBe(true);
    const notices = listMessages(sessionId).filter((row) => row.text === "Session is now idle.");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ author: "agent", extraMarkdown: "2 minutes" });
  }, 140_000);

  it("isolated gate: Stop stays busy after stamping cliTurnEndedAt until the Cursor child exits", async () => {
    const sessionId = `cur_${randomUUID()}`;
    const cwd = mkdtempSync(path.join(tmpdir(), "say-to-me-cursor-busy-gate-"));
    const provider = path.join(cwd, "cursor-agent.sh");
    writeFileSync(
      provider,
      [
        "#!/bin/sh",
        "sleep 5",
        `printf '%s\\n' '${JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "5" }] },
        })}'`,
        "sleep 8",
        `printf '%s\\n' '${JSON.stringify({
          type: "result",
          is_error: false,
          result: "2 minutes",
        })}'`,
        "",
      ].join("\n"),
    );
    chmodSync(provider, 0o755);
    process.env.SAY_TO_ME_CURSOR_WORKER_MODE = "cursor";
    process.env.SAY_TO_ME_CURSOR_BIN = provider;
    expect(new URL(process.env.SAY_TO_ME_INTERNAL_URL!).port).not.toBe("5411");
    setSessionCwd(sessionId, cwd);
    const message = insertMessageRow({
      sessionId,
      text: "sleep 5, reply 5, sleep, reply 2 minutes",
      extraMarkdown: null,
      author: "user",
      status: "received",
      links: null,
      sessionRefs: null,
      clientMessageId: null,
    });
    enqueueCursorDeliveryJob({
      messageId: message.id,
      messageSessionId: sessionId,
      cursorSessionId: sessionId,
      kind: "direct_user_message",
    });

    const worker = Effect.runPromise(runCursorRestDeliveryOnce("busy-gate", sessionId));
    await expect
      .poll(
        () => listMessages(sessionId).some((row) => row.author === "agent" && row.text === "5"),
        { timeout: 15_000 },
      )
      .toBe(true);

    drizzleDb
      .update(cursorDeliveryJobs)
      .set({ cliTurnEndedAt: Date.now() })
      .where(eq(cursorDeliveryJobs.messageId, message.id))
      .run();
    expect(hasExternalCliSessionWork(sessionId)).toBe(true);

    await expect(worker).resolves.toBe(true);
    expect(hasExternalCliSessionWork(sessionId)).toBe(false);
  }, 40_000);

  it("includes the isolated CLI origin", () => {
    expect(
      cursorDeliveryPrompt(
        { cursorSessionId: "cur_abc" },
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
