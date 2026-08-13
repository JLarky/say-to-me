import path from "node:path";
import { tmpdir } from "node:os";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  Uploads,
  getMessageAttachmentEffect,
  uploadAttachmentEffect,
  uploadImageHttpApiWebHandler,
  type UploadsService,
} from "./uploads.ts";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function uploadsLayer(service: Partial<UploadsService> = {}) {
  const calls: string[] = [];
  const base: UploadsService = {
    writeUpload: (targetPath, body) =>
      Effect.sync(() => {
        calls.push(`write:${targetPath}:${body.length}`);
      }),
    buildThumbnail: () =>
      Effect.succeed({
        thumbnailDataUrl: "data:image/webp;base64,thumb",
        thumbnailWidth: 1,
        thumbnailHeight: 1,
      }),
    getAttachment: () => Effect.succeed(null),
    attachmentFileExists: () => Effect.succeed(false),
  };
  return { calls, layer: Layer.succeed(Uploads, { ...base, ...service }) };
}

describe("upload attachment effect", () => {
  it("rejects unsupported mime types", async () => {
    const { layer } = uploadsLayer();
    const result = await Effect.runPromise(
      uploadAttachmentEffect({
        mimeType: "text/plain",
        originalNameHeader: "file.txt",
        targetPathHeader: null,
        body: Buffer.from("x"),
        allowedMimeTypes: new Set(["image/png"]),
        label: "image",
      }).pipe(Effect.flip, Effect.provide(layer)),
    );

    expect(result.error).toBe("Unsupported image type.");
    expect(result.status).toBe(400);
  });

  it("stores a valid image upload through the injected service", async () => {
    const { calls, layer } = uploadsLayer();
    const targetPath = path.join(tmpdir(), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png");

    const attachment = await Effect.runPromise(
      uploadAttachmentEffect({
        mimeType: "image/png",
        originalNameHeader: "shot.png",
        targetPathHeader: targetPath,
        body: tinyPng,
        allowedMimeTypes: new Set(["image/png"]),
        label: "image",
      }).pipe(Effect.provide(layer)),
    );

    expect(attachment.filePath).toBe(targetPath);
    expect(attachment.thumbnailDataUrl).toContain("data:image/webp;base64,");
    expect(calls).toEqual([`write:${targetPath}:${tinyPng.length}`]);
  });
});

describe("get message attachment effect", () => {
  it("returns 404 when the attachment record is missing", async () => {
    const { layer } = uploadsLayer();
    const result = await Effect.runPromise(
      getMessageAttachmentEffect("42").pipe(Effect.flip, Effect.provide(layer)),
    );

    expect(result).toMatchObject({ error: "Attachment not found.", status: 404 });
  });
});

describe("upload image web handler", () => {
  it("returns 400 JSON for an empty body", async () => {
    const targetPath = path.join(tmpdir(), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png");
    const response = await uploadImageHttpApiWebHandler(
      new Request("http://say.local/api/uploads/image", {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-File-Name": "empty.png",
          "X-Target-Path": targetPath,
        },
        body: new Uint8Array(),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Image body is required." });
  });
});
