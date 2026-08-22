import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type ApiMessage,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  listen,
  mockOpenCode,
  waitFor,
  createTestSession,
} from "./api.harness.ts";
import { MessagesPayload } from "../src/types.ts";
import { parseJson, UnknownJson } from "@say-to-me/runtime-validation";
import { insertMessageRow, markCompletionWorkSeen, updateOpencodeDelivery } from "./messages.ts";
import { opencodeStatusCache } from "./opencode/cache.ts";
import { setCompletionWatchNextCheckAt } from "./messages.ts";
import {
  runCompletionWatchTick,
  setCompletionWatchAutoPollingForTest,
  stopAllCompletionWatches,
} from "./opencode/completion-watch.ts";

describe.sequential("say API: OpenCode completion watches", () => {
  let server: TestServer;
  let origin: string;
  const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;

  beforeEach(async () => {
    setCompletionWatchAutoPollingForTest(false);
    stopAllCompletionWatches();
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
    opencodeStatusCache.clear();
  });

  afterEach(async () => {
    stopAllCompletionWatches();
    setCompletionWatchAutoPollingForTest(true);
    process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
    opencodeStatusCache.clear();
    await closeServer(server);
  });

  async function messages(sessionId: string): Promise<ApiMessage[]> {
    const response = await fetch(`${origin}/api/sessions/${sessionId}/messages`);
    const text = await response.text();
    if (!response.ok) throw new Error(text);
    const queue = parseJson(MessagesPayload, text);
    return (queue.messages ?? []) as ApiMessage[];
  }

  async function jsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.ok) throw new Error(text);
    return parseJson(UnknownJson, text) as T;
  }

  function systemMessages(items: ApiMessage[]): ApiMessage[] {
    return items.filter(
      (message) =>
        message.text.startsWith("<say-to-me-system>") || message.text === "Session is now idle.",
    );
  }

  async function waitForMessageStatus(
    sessionId: string,
    messageId: number,
    status: string,
  ): Promise<ApiMessage> {
    let found: ApiMessage | undefined;
    await waitFor(async () => {
      found = (await messages(sessionId)).find((message) => message.id === messageId);
      return found?.opencodeDeliveryStatus === status;
    });
    return found!;
  }

  function closeServer(server: TestServer): Promise<void> {
    return new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async function installOpenCodeMock({
    sourceSessionId,
    targetSessionId,
    sourceFailures = 0,
    sourceInitiallyBusy = false,
    targetCompletesBeforePoll = false,
    targetInitiallyBusy = false,
  }: {
    sourceSessionId: string;
    targetSessionId: string;
    sourceFailures?: number;
    sourceInitiallyBusy?: boolean;
    targetCompletesBeforePoll?: boolean;
    targetInitiallyBusy?: boolean;
  }) {
    let sourceStatus = sourceInitiallyBusy ? "busy" : "idle";
    let targetStatus = targetInitiallyBusy ? "busy" : "idle";
    let remainingSourceFailures = sourceFailures;

    const openCode = await mockOpenCode((req, res) => {
      const respond = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (req.url?.startsWith("/session/status")) {
        return respond(200, {
          [sourceSessionId]: { type: sourceStatus },
          [targetSessionId]: { type: targetStatus },
        });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${targetSessionId}/message`)) {
        if (targetCompletesBeforePoll) {
          targetStatus = "idle";
          opencodeStatusCache.clear();
          return respond(200, { info: { id: "msg_target" }, parts: [] });
        }
        targetStatus = "busy";
        opencodeStatusCache.clear();
        return respond(200, { info: { id: "msg_target" }, parts: [] });
      }
      if (req.method === "POST" && req.url?.startsWith(`/session/${sourceSessionId}/message`)) {
        sourceStatus = "busy";
        opencodeStatusCache.clear();
        if (remainingSourceFailures > 0) {
          remainingSourceFailures -= 1;
          return respond(500, { error: "temporary source failure" });
        }
        return respond(200, { info: { id: "msg_source_notice" }, parts: [] });
      }
      if (req.url?.startsWith(`/session/${sourceSessionId}`)) {
        return respond(200, { id: sourceSessionId, directory: "/tmp/source" });
      }
      if (req.url?.startsWith(`/session/${targetSessionId}`)) {
        return respond(200, { id: targetSessionId, directory: "/tmp/target" });
      }
      res.writeHead(404).end();
    });
    return {
      ...openCode,
      setSourceStatus(status: string) {
        sourceStatus = status;
        opencodeStatusCache.clear();
      },
      setTargetStatus(status: string) {
        targetStatus = status;
        opencodeStatusCache.clear();
      },
    };
  }

  async function completeTargetWork(
    sessionId: string,
    messageId: number,
    openCode: Awaited<ReturnType<typeof installOpenCodeMock>>,
  ) {
    await waitForMessageStatus(sessionId, messageId, "sent");
    await runCompletionWatchTick(messageId);
    openCode.setTargetStatus("idle");
    setCompletionWatchNextCheckAt(messageId, Date.now() - 1);
    await runCompletionWatchTick(messageId);
  }

  it("defaults forwarded messages to target and source completion notifications", async () => {
    const sourceSessionId = "ses_32a3a39f5ccdIhIMtLJ5od58Ey";
    const targetSessionId = "ses_26f5aeb1976f4B0RsHqLm8qShF";
    const openCode = await installOpenCodeMock({ sourceSessionId, targetSessionId });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const created = await jsonResponse<{ message: ApiMessage; targetMessage: ApiMessage }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "user", targetSessionId, text: "watch this" }),
        }),
      );

      await completeTargetWork(targetSessionId, created.targetMessage.id, openCode);

      const targetItems = await messages(targetSessionId);
      const sourceItems = await messages(sourceSessionId);
      const watched = targetItems.find((message) => message.id === created.targetMessage.id)!;
      const targetNotice = systemMessages(targetItems)[0];
      const sourceNotice = sourceItems.find((message) => message.text.includes("is now idle"))!;
      expect(watched).toMatchObject({ completionWatchStatus: "completed" });
      expect(systemMessages(targetItems)).toHaveLength(1);
      expect(targetNotice).toMatchObject({
        author: "agent",
        opencodeDeliveryStatus: "ui_only",
      });
      expect(sourceNotice).toMatchObject({
        author: "user",
        opencodeDeliveryStatus: "sent",
        opencodeMessageId: "msg_source_notice",
        forwardRole: "source",
        forwardTargetSessionId: targetSessionId,
      });

      await runCompletionWatchTick(created.targetMessage.id);
      expect(systemMessages(await messages(targetSessionId))).toHaveLength(1);
      expect(
        (await messages(sourceSessionId)).filter((m) => m.text.includes("is now idle")),
      ).toHaveLength(1);
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${targetSessionId}/message`),
        ),
      ).toHaveLength(1);
    } finally {
      await closeServer(openCode.server);
    }
  });

  it("honors explicit forwarded notifyOnCompletion false", async () => {
    const sourceSessionId = "ses_b7fdfd4116d1sGEgd6ep3dpL49";
    const targetSessionId = "ses_932ce55a8d579D6H10u5RfW1JM";
    const openCode = await installOpenCodeMock({ sourceSessionId, targetSessionId });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "user",
          targetSessionId,
          text: "do not watch",
          notifyOnCompletion: false,
        }),
      });
      expect(systemMessages(await messages(targetSessionId))).toHaveLength(0);
      expect(
        (await messages(sourceSessionId)).filter((m) => m.text.includes("idle now")),
      ).toHaveLength(0);
    } finally {
      await closeServer(openCode.server);
    }
  });

  it("completes forwarded watches when the prompt returns after OpenCode is already idle", async () => {
    const sourceSessionId = "ses_459d6a5e08d7fxKUAftfclkhPO";
    const targetSessionId = "ses_539c0133bee8ZlSlYMXIlBHyOt";
    const openCode = await installOpenCodeMock({
      sourceSessionId,
      targetSessionId,
      targetCompletesBeforePoll: true,
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const created = await jsonResponse<{ message: ApiMessage; targetMessage: ApiMessage }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "user", targetSessionId, text: "fast watched forward" }),
        }),
      );

      await waitForMessageStatus(targetSessionId, created.targetMessage.id, "sent");
      await runCompletionWatchTick(created.targetMessage.id);

      const watched = (await messages(targetSessionId)).find(
        (message) => message.id === created.targetMessage.id,
      )!;
      expect(watched).toMatchObject({
        completionWatchStatus: "completed",
        completionWatchWorkSeen: 1,
      });
    } finally {
      await closeServer(openCode.server);
    }
  });

  it("starts watching forwarded prompts only after queued delivery flushes", async () => {
    const sourceSessionId = "ses_941902450e84nP9doy6vdPGxl4";
    const targetSessionId = "ses_f33941222decPeAYKFmklWJRnU";
    const openCode = await installOpenCodeMock({
      sourceSessionId,
      targetSessionId,
      targetInitiallyBusy: true,
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const created = await jsonResponse<{ message: ApiMessage; targetMessage: ApiMessage }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "user", targetSessionId, text: "queue then watch" }),
        }),
      );
      expect(created.targetMessage.opencodeDeliveryStatus).toBe("queued");

      opencodeStatusCache.clear();
      openCode.setTargetStatus("idle");
      await completeTargetWork(targetSessionId, created.targetMessage.id, openCode);

      const source = (await messages(sourceSessionId)).find((m) => m.id === created.message.id)!;
      const targetItems = await messages(targetSessionId);
      const deliveredTarget = targetItems.find((m) => m.id === created.targetMessage.id)!;
      const sourceTarget = targetItems.find((m) => m.id === source.forwardTargetMessageId)!;
      expect(
        sourceTarget.id === deliveredTarget.id ||
          sourceTarget.mergedIntoMessageId === deliveredTarget.id,
      ).toBe(true);
      expect(deliveredTarget).toMatchObject({
        forwardRole: "target",
        completionWatchStatus: "completed",
      });
    } finally {
      await closeServer(openCode.server);
    }
  });

  it("emits an idle marker for queued direct prompts after delivery and work", async () => {
    const sessionId = "ses_8e8625bb26383zcHXuzcQ1cYoQ";
    const openCode = await installOpenCodeMock({
      sourceSessionId: "ses_a75443b682042ZRP2LLKRM7Eux",
      targetSessionId: sessionId,
      targetInitiallyBusy: true,
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const created = await jsonResponse<{ message: ApiMessage }>(
        await fetch(`${origin}/api/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "user", text: "direct later", notifyOnCompletion: true }),
        }),
      );
      expect(created.message.opencodeDeliveryStatus).toBe("queued");

      opencodeStatusCache.clear();
      openCode.setTargetStatus("idle");
      await completeTargetWork(sessionId, created.message.id, openCode);
      const items = await messages(sessionId);
      // Direct prompts get a target idle marker, not a source "after relay" notice.
      expect(systemMessages(items)).toHaveLength(1);
      expect(items.filter((m) => m.forwardRole === "source")).toHaveLength(0);
    } finally {
      await closeServer(openCode.server);
    }
  });

  it("retries a failed source notification without duplicating messages", async () => {
    const sourceSessionId = "ses_363e8102bbd8bV217R1m12JlIY";
    const targetSessionId = "ses_27bb36233f03sTMEyoq7IfJKXu";
    const openCode = await installOpenCodeMock({
      sourceSessionId,
      targetSessionId,
      sourceFailures: 2,
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", targetSessionId, text: "retry notice" }),
      });

      const target = (await messages(targetSessionId)).find(
        (message) => message.author === "user",
      )!;
      await completeTargetWork(targetSessionId, target.id, openCode);
      openCode.setSourceStatus("idle");
      setCompletionWatchNextCheckAt(target.id, Date.now() - 1);
      await runCompletionWatchTick(target.id);
      const notices = (await messages(sourceSessionId)).filter(
        (m) => m.text.includes("idle now after") && m.forwardRole === "source",
      );
      expect(notices).toHaveLength(1);
      await waitFor(
        () =>
          openCode.requests.filter(
            (request) =>
              request.method === "POST" &&
              request.url?.startsWith(`/session/${sourceSessionId}/message`),
          ).length >= 1,
      );
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${sourceSessionId}/message`),
        ).length,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      await closeServer(openCode.server);
    }
  });

  it("batches multiple completed forwards into one queued source notification while source is busy", async () => {
    const sourceSessionId = "ses_80c69225a4b0Dz3VO9BqMZfspr";
    const targetSessionId = "ses_a02fbd1c4c0fKX6ya7y4TSIh43";
    const openCode = await installOpenCodeMock({
      sourceSessionId,
      targetSessionId,
      sourceInitiallyBusy: true,
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const first = await jsonResponse<{ message: ApiMessage; targetMessage: ApiMessage }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "user", targetSessionId, text: "first watched forward" }),
        }),
      );
      await completeTargetWork(targetSessionId, first.targetMessage.id, openCode);

      const second = await jsonResponse<{ message: ApiMessage; targetMessage: ApiMessage }>(
        await fetch(`${origin}/api/sessions/${sourceSessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "user", targetSessionId, text: "second watched forward" }),
        }),
      );
      await completeTargetWork(targetSessionId, second.targetMessage.id, openCode);

      const sourceNotices = (await messages(sourceSessionId)).filter((message) =>
        message.text.includes(`${targetSessionId} is idle now after`),
      );
      expect(sourceNotices).toHaveLength(1);
      expect(sourceNotices[0]).toMatchObject({
        opencodeDeliveryStatus: "queued",
        forwardRole: "source",
        forwardTargetSessionId: targetSessionId,
      });
      expect(sourceNotices[0].text).toContain(targetSessionId);
      expect(sourceNotices[0].text).toContain("watched forward");
      expect(
        openCode.requests.filter(
          (request) =>
            request.method === "POST" &&
            request.url?.startsWith(`/session/${sourceSessionId}/message`),
        ),
      ).toHaveLength(0);
    } finally {
      await closeServer(openCode.server);
    }
  });

  it("resumes pending completion watches from durable rows on API startup", async () => {
    const sessionId = "ses_46a86a08f330bPaDEalvm5S9NT";
    const openCode = await installOpenCodeMock({
      sourceSessionId: "ses_2000510ec43e1QSNxmzzPMPWPh",
      targetSessionId: sessionId,
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession(sessionId);
      const watched = insertMessageRow({
        sessionId,
        text: "resume watched prompt",
        extraMarkdown: null,
        author: "user",
        status: "received",
        links: null,
        sessionRefs: null,
        clientMessageId: null,
        completionWatchStatus: "watching",
      });
      updateOpencodeDelivery(watched.id, "sent", null, "msg_resume_watch");
      markCompletionWorkSeen(watched.id);

      await closeServer(server);
      stopAllCompletionWatches();
      setCompletionWatchAutoPollingForTest(true);
      ({ server, origin } = await listen(createApiMiddleware()));

      await waitFor(async () => {
        const watchedAfterResume = (await messages(sessionId)).find(
          (message) => message.id === watched.id,
        );
        return watchedAfterResume?.completionWatchStatus === "completed";
      });

      const sessionMessages = await messages(sessionId);
      expect(sessionMessages.find((message) => message.id === watched.id)).toMatchObject({
        completionWatchStatus: "completed",
        completionWatchWorkSeen: 1,
      });
      expect(systemMessages(sessionMessages)).toHaveLength(1);
    } finally {
      await closeServer(openCode.server);
    }
  });
});
