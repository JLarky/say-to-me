import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type ApiMessage,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  listen,
  mockOpenCode,
  teardownApi,
  tinyPng,
  waitFor,
  createTestSession,
} from "./api.harness.ts";

const tinyMp3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

async function waitForPrompt(
  openCode: Awaited<ReturnType<typeof mockOpenCode>>,
  url: string,
): Promise<(typeof openCode.requests)[number]> {
  let prompt: (typeof openCode.requests)[number] | undefined;
  await waitFor(() => {
    prompt = openCode.requests.find((request) => request.url === url);
    return prompt != null;
  });
  return prompt!;
}

describe("say API: images", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("uploads image attachments, persists them separately, and includes tmp paths in OpenCode prompts", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_1dd864100ffes6uqv2NbJatAKt: { type: "idle" } }));
        return;
      }
      res.end(JSON.stringify({ info: { id: "msg_with_image" }, parts: [] }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    const filePath = path.join(tmpdir(), "11111111-1111-4111-8111-111111111111.png");

    try {
      await createTestSession("ses_1dd864100ffes6uqv2NbJatAKt");
      const upload = await fetch(`${origin}/api/uploads/image`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-File-Name": "file1.png",
          "X-Target-Path": filePath,
        },
        body: tinyPng,
      }).then((response) => response.json());

      const created = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "user", text: `color?\n${upload.attachment.filePath}` }),
        },
      ).then((response) => response.json());

      const promptRequest = await waitForPrompt(
        openCode,
        "/session/ses_1dd864100ffes6uqv2NbJatAKt/message",
      );

      expect(promptRequest).toBeDefined();
      const promptBody = promptRequest!.body as { parts: { type: string; text: string }[] };
      expect(promptBody.parts[0].text).toContain(upload.attachment.filePath);
      expect(created.message.attachments).toHaveLength(1);
      expect(created.message.attachments[0]).toMatchObject({
        filePath: upload.attachment.filePath,
        mimeType: "image/png",
        thumbnailDataUrl: expect.stringContaining("data:image/webp;base64,"),
      });

      rmSync(filePath, { force: true });
      const queueAfterDelete = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
      ).then((response) => response.json());
      const uploadedMessage = queueAfterDelete.messages.find(
        (message: ApiMessage) => message.id === created.message.id,
      );

      expect(uploadedMessage.attachments[0]).toMatchObject({
        filePath: upload.attachment.filePath,
        thumbnailDataUrl: expect.stringContaining("data:image/webp;base64,"),
      });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
      rmSync(filePath, { force: true });
    }
  });

  it("accepts upload targets under the OS temp dir, not just hardcoded /tmp", async () => {
    // os.tmpdir() is not always "/tmp" (macOS, sandboxes); it must be accepted too.
    const tempDirPath = path.join(tmpdir(), "66666666-6666-4666-8666-666666666666.png");

    try {
      const accepted = await fetch(`${origin}/api/uploads/image`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-File-Name": "shot.png",
          "X-Target-Path": tempDirPath,
        },
        body: tinyPng,
      });
      const acceptedBody = await accepted.json();
      expect(accepted.status).toBe(201);
      expect(acceptedBody.attachment.filePath).toBe(tempDirPath);
    } finally {
      rmSync(tempDirPath, { force: true });
      server.close();
    }
  });

  it("attaches an explicit images[] array and rejects non-array entries with 400", async () => {
    const imagePath = path.join("/tmp", "33333333-3333-4333-8333-333333333333.png");
    writeFileSync(imagePath, tinyPng);

    try {
      await createTestSession("ses_46a41f38ab7c3oDcwmT67CljZd");
      const created = await fetch(
        `${origin}/api/sessions/ses_46a41f38ab7c3oDcwmT67CljZd/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "shot", images: [imagePath] }),
        },
      ).then((response) => response.json());

      expect(created.message.attachments).toHaveLength(1);
      expect(created.message.attachments[0].filePath).toBe(imagePath);

      const deduped = await fetch(
        `${origin}/api/sessions/ses_46a41f38ab7c3oDcwmT67CljZd/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: `look ${imagePath}`, images: [imagePath] }),
        },
      ).then((response) => response.json());
      expect(deduped.message.attachments).toHaveLength(1);

      const notArray = await fetch(
        `${origin}/api/sessions/ses_46a41f38ab7c3oDcwmT67CljZd/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "bad", images: "nope" }),
        },
      );
      expect(notArray.status).toBe(400);
    } finally {
      rmSync(imagePath, { force: true });
      server.close();
    }
  });

  it("accepts an image-only message (empty text) when images[] is present", async () => {
    const imagePath = path.join("/tmp", "66666666-6666-4666-8666-666666666666.png");
    writeFileSync(imagePath, tinyPng);

    try {
      await createTestSession("ses_29defc858041zukJLjY68XF9zG");
      const created = await fetch(
        `${origin}/api/sessions/ses_29defc858041zukJLjY68XF9zG/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "", images: [imagePath] }),
        },
      );
      const body = await created.json();

      expect(created.status).toBe(201);
      expect(body.message.text).toBe("");
      expect(body.message.attachments).toHaveLength(1);
      expect(body.message.attachments[0].filePath).toBe(imagePath);

      // Empty text with no images is still rejected.
      const emptyNoImages = await fetch(
        `${origin}/api/sessions/ses_29defc858041zukJLjY68XF9zG/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "" }),
        },
      );
      expect(emptyNoImages.status).toBe(400);
    } finally {
      rmSync(imagePath, { force: true });
      server.close();
    }
  });

  it("rejects a corrupt images[] entry with 400 and stores no message", async () => {
    const corruptPath = path.join("/tmp", "44444444-4444-4444-8444-444444444444.png");
    writeFileSync(corruptPath, Buffer.from("this is not a real png"));

    try {
      await createTestSession("ses_854f73b0f902i49RtQROQKpfxq");
      const response = await fetch(
        `${origin}/api/sessions/ses_854f73b0f902i49RtQROQKpfxq/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "broken", images: [corruptPath] }),
        },
      );
      expect(response.status).toBe(400);

      const queue = await fetch(
        `${origin}/api/sessions/ses_854f73b0f902i49RtQROQKpfxq/messages`,
      ).then((response) => response.json());
      expect(queue.messages).toHaveLength(0);
    } finally {
      rmSync(corruptPath, { force: true });
      server.close();
    }
  });

  it("forwards images[] paths to OpenCode even when not inlined in the text", async () => {
    const imagePath = path.join("/tmp", "55555555-5555-4555-8555-555555555555.png");
    writeFileSync(imagePath, tinyPng);
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_6cc990ea8e5e2nEOqB8XPN7TQ3: { type: "idle" } }));
        return;
      }
      res.end(JSON.stringify({ info: { id: "msg_img" }, parts: [] }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await createTestSession("ses_6cc990ea8e5e2nEOqB8XPN7TQ3");
      await fetch(`${origin}/api/sessions/ses_6cc990ea8e5e2nEOqB8XPN7TQ3/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "user", text: "what is this", images: [imagePath] }),
      });

      const promptRequest = await waitForPrompt(
        openCode,
        "/session/ses_6cc990ea8e5e2nEOqB8XPN7TQ3/message",
      );
      expect(promptRequest).toBeDefined();
      const body = promptRequest!.body as { parts: { type: string; text: string }[] };
      expect(body.parts[0].text).toContain(imagePath);
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
      rmSync(imagePath, { force: true });
    }
  });

  it("serves the full-quality image for an existing attachment and fails safely otherwise", async () => {
    const filePath = path.join("/tmp", "22222222-2222-4222-8222-222222222222.png");

    try {
      const upload = await fetch(`${origin}/api/uploads/image`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-File-Name": "full.png",
          "X-Target-Path": filePath,
        },
        body: tinyPng,
      }).then((response) => response.json());

      await createTestSession("ses_1dd864100ffes6uqv2NbJatAKt");
      const created = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: `look\n${upload.attachment.filePath}` }),
        },
      ).then((response) => response.json());

      const attachment = created.message.attachments[0];
      expect(attachment.url).toBe(`/api/message-attachments/${attachment.id}`);

      const ok = await fetch(`${origin}${attachment.url}`);
      expect(ok.status).toBe(200);
      expect(ok.headers.get("content-type")).toContain("image/png");

      const invalid = await fetch(`${origin}/api/message-attachments/not-a-number`);
      expect(invalid.status).toBe(400);

      const unknown = await fetch(`${origin}/api/message-attachments/99999999`);
      expect(unknown.status).toBe(404);

      rmSync(filePath, { force: true });
      const missingFile = await fetch(`${origin}${attachment.url}`);
      expect(missingFile.status).toBe(404);
    } finally {
      server.close();
      rmSync(filePath, { force: true });
    }
  });

  it("uploads mp3 attachments, persists them, and serves them as audio", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const openCode = await mockOpenCode((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.url?.startsWith("/session/status")) {
        res.end(JSON.stringify({ ses_6ce5ff1baee9GmbSi9cft4Yy0v: { type: "idle" } }));
        return;
      }
      res.end(JSON.stringify({ info: { id: "msg_audio" }, parts: [] }));
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;
    const filePath = path.join(tmpdir(), "77777777-7777-4777-8777-777777777777.mp3");

    try {
      await createTestSession("ses_6ce5ff1baee9GmbSi9cft4Yy0v");
      const uploadResponse = await fetch(`${origin}/api/uploads/attachment`, {
        method: "POST",
        headers: {
          "Content-Type": "audio/mpeg",
          "X-File-Name": "elevator.mp3",
          "X-Target-Path": filePath,
        },
        body: tinyMp3,
      });
      const upload = await uploadResponse.json();
      expect(uploadResponse.status).toBe(201);
      expect(upload.attachment).toMatchObject({
        filePath,
        originalName: "elevator.mp3",
        mimeType: "audio/mpeg",
        thumbnailDataUrl: "",
      });

      const created = await fetch(
        `${origin}/api/sessions/ses_6ce5ff1baee9GmbSi9cft4Yy0v/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "user", text: `audio ${filePath}`, images: [filePath] }),
        },
      ).then((response) => response.json());
      const promptRequest = await waitForPrompt(
        openCode,
        "/session/ses_6ce5ff1baee9GmbSi9cft4Yy0v/message",
      );
      const promptBody = promptRequest.body as { parts: { type: string; text: string }[] };
      expect(created.message.text).toBe("audio [audio attachment]");
      expect(promptBody.parts[0].text).toContain("audio [audio attachment]");
      expect(promptBody.parts[0].text).not.toContain(filePath);

      const attachment = created.message.attachments[0];
      expect(attachment).toMatchObject({
        filePath,
        originalName: path.basename(filePath),
        mimeType: "audio/mpeg",
        thumbnailDataUrl: "",
      });

      const served = await fetch(`${origin}${attachment.url}`);
      expect(served.status).toBe(200);
      expect(served.headers.get("content-type")).toContain("audio/mpeg");
      expect(Buffer.from(await served.arrayBuffer())).toEqual(tinyMp3);

      const invalidUpload = await fetch(`${origin}/api/uploads/attachment`, {
        method: "POST",
        headers: {
          "Content-Type": "audio/mpeg",
          "X-File-Name": "bad.mp3",
          "X-Target-Path": path.join(tmpdir(), "88888888-8888-4888-8888-888888888888.mp3"),
        },
        body: Buffer.from("not mp3"),
      });
      expect(invalidUpload.status).toBe(400);

      const nonUuidPath = path.join(tmpdir(), "elevator.mp3");
      writeFileSync(nonUuidPath, tinyMp3);
      const nonUuidMessage = await fetch(
        `${origin}/api/sessions/ses_6ce5ff1baee9GmbSi9cft4Yy0v/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "audio", images: [nonUuidPath] }),
        },
      );
      expect(nonUuidMessage.status).toBe(400);
      rmSync(nonUuidPath, { force: true });

      const symlinkPath = path.join(tmpdir(), "99999999-9999-4999-8999-999999999999.mp3");
      rmSync(symlinkPath, { force: true });
      symlinkSync(filePath, symlinkPath);
      const symlinkUpload = await fetch(`${origin}/api/uploads/attachment`, {
        method: "POST",
        headers: {
          "Content-Type": "audio/mpeg",
          "X-File-Name": "symlink.mp3",
          "X-Target-Path": symlinkPath,
        },
        body: tinyMp3,
      });
      expect(symlinkUpload.status).toBe(400);
      rmSync(symlinkPath, { force: true });
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
      rmSync(filePath, { force: true });
      rmSync(path.join(tmpdir(), "88888888-8888-4888-8888-888888888888.mp3"), { force: true });
      rmSync(path.join(tmpdir(), "elevator.mp3"), { force: true });
      rmSync(path.join(tmpdir(), "99999999-9999-4999-8999-999999999999.mp3"), { force: true });
    }
  });
});
