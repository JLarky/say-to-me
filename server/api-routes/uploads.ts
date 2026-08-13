import { Context, Effect, Layer } from "effect";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { maxImageUploadBytes } from "../config.ts";
import {
  allowedAttachmentMimeTypes,
  allowedImageMimeTypes,
  buildThumbnailData,
  getAttachment,
  isMp3Buffer,
  normalizeUploadFilename,
  validateClientUploadTargetPath,
} from "../images.ts";

export type UploadValidationError = {
  _tag: "UploadValidationError";
  error: string;
  status: number;
};

export type UploadResult = {
  filePath: string;
  mimeType: string;
  originalName: string;
  thumbnailDataUrl: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
};

export type AttachmentFileResult = {
  filePath: string;
  mimeType: string;
  originalName: string;
};

export type UploadsService = {
  writeUpload: (targetPath: string, body: Buffer) => Effect.Effect<void, UploadValidationError>;
  buildThumbnail: (body: Buffer) => Effect.Effect<{
    thumbnailDataUrl: string;
    thumbnailWidth: number;
    thumbnailHeight: number;
  }>;
  getAttachment: (attachmentId: number) => Effect.Effect<AttachmentFileResult | null>;
  attachmentFileExists: (filePath: string) => Effect.Effect<boolean>;
};

export const Uploads = Context.GenericTag<UploadsService>("say-to-me/Uploads");

export const UploadsLive = Layer.succeed(Uploads, {
  writeUpload: (targetPath, body) =>
    Effect.try({
      try: () => {
        writeFileSync(targetPath, body, { flag: "wx", mode: 0o600 });
      },
      catch: (error) => ({
        _tag: "UploadValidationError" as const,
        error: error instanceof Error ? error.message : "Unable to store upload.",
        status: 400,
      }),
    }),
  buildThumbnail: (body) => Effect.promise(() => buildThumbnailData(body)),
  getAttachment: (attachmentId) =>
    Effect.sync(() => {
      const attachment = getAttachment(attachmentId);
      if (!attachment) return null;
      return {
        filePath: attachment.filePath,
        mimeType: attachment.mimeType,
        originalName: attachment.originalName,
      };
    }),
  attachmentFileExists: (filePath) =>
    Effect.sync(() => {
      if (!existsSync(filePath)) return false;
      return statSync(filePath).isFile();
    }),
} satisfies UploadsService);

function uploadValidationError(error: string, status = 400): UploadValidationError {
  return { _tag: "UploadValidationError", error, status };
}

function inlineAttachmentDisposition(originalName: string): string {
  const filename = path.basename(originalName || "attachment") || "attachment";
  const fallback = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function uploadAttachmentEffect({
  mimeType,
  originalNameHeader,
  targetPathHeader,
  body,
  allowedMimeTypes,
  label,
}: {
  mimeType: string;
  originalNameHeader: string | null;
  targetPathHeader: string | null;
  body: Buffer;
  allowedMimeTypes: Set<string>;
  label: "attachment" | "image";
}): Effect.Effect<UploadResult, UploadValidationError, UploadsService> {
  return Effect.gen(function* () {
    if (!allowedMimeTypes.has(mimeType)) {
      return yield* Effect.fail(uploadValidationError(`Unsupported ${label} type.`));
    }

    const originalName = normalizeUploadFilename(originalNameHeader ?? label);
    const targetPath = targetPathHeader ?? path.join("/tmp", `${randomUUID()}-${originalName}`);

    try {
      validateClientUploadTargetPath(targetPath, mimeType);
    } catch (error) {
      return yield* Effect.fail(
        uploadValidationError(
          error instanceof Error ? error.message : "Invalid upload target path.",
        ),
      );
    }

    if (body.length === 0) {
      return yield* Effect.fail(
        uploadValidationError(`${label[0].toUpperCase()}${label.slice(1)} body is required.`),
      );
    }
    if (body.length > maxImageUploadBytes) {
      return yield* Effect.fail(
        uploadValidationError(`Upload exceeds ${maxImageUploadBytes} bytes.`),
      );
    }
    if (mimeType === "audio/mpeg" && !isMp3Buffer(body)) {
      return yield* Effect.fail(uploadValidationError("Uploaded MP3 is invalid."));
    }

    const uploads = yield* Uploads;
    const thumbnail = mimeType.startsWith("image/")
      ? yield* uploads.buildThumbnail(body)
      : { thumbnailDataUrl: "", thumbnailWidth: 0, thumbnailHeight: 0 };
    yield* uploads.writeUpload(targetPath, body);

    return {
      filePath: targetPath,
      mimeType,
      originalName,
      thumbnailDataUrl: thumbnail.thumbnailDataUrl,
      thumbnailWidth: thumbnail.thumbnailWidth,
      thumbnailHeight: thumbnail.thumbnailHeight,
    };
  });
}

export function getMessageAttachmentEffect(
  rawAttachmentId: string,
): Effect.Effect<AttachmentFileResult, UploadValidationError, UploadsService> {
  return Effect.gen(function* () {
    const attachmentId = Number(rawAttachmentId);
    if (!Number.isInteger(attachmentId)) {
      return yield* Effect.fail(uploadValidationError("Invalid attachment id."));
    }

    const uploads = yield* Uploads;
    const attachment = yield* uploads.getAttachment(attachmentId);
    if (!attachment) {
      return yield* Effect.fail(uploadValidationError("Attachment not found.", 404));
    }

    const exists = yield* uploads.attachmentFileExists(attachment.filePath);
    if (!exists) {
      return yield* Effect.fail(uploadValidationError("Attachment file not found.", 404));
    }

    return attachment;
  });
}

async function readUploadBody(request: Request): Promise<Buffer> {
  const body = await request.arrayBuffer();
  return Buffer.from(body);
}

function uploadJsonError(error: UploadValidationError): Response {
  return Response.json({ error: error.error }, { status: error.status });
}

async function runUploadHandler(
  request: Request,
  allowedMimeTypes: Set<string>,
  label: "attachment" | "image",
): Promise<Response> {
  const mimeType = request.headers.get("content-type") ?? "";
  const body = await readUploadBody(request);
  const outcome = await Effect.runPromise(
    uploadAttachmentEffect({
      mimeType,
      originalNameHeader: request.headers.get("x-file-name"),
      targetPathHeader: request.headers.get("x-target-path"),
      body,
      allowedMimeTypes,
      label,
    }).pipe(
      Effect.provide(UploadsLive),
      Effect.match({
        onFailure: (error) => ({ kind: "error" as const, error }),
        onSuccess: (attachment) => ({ kind: "ok" as const, attachment }),
      }),
    ),
  );

  if (outcome.kind === "error") return uploadJsonError(outcome.error);
  return Response.json({ attachment: outcome.attachment }, { status: 201 });
}

export async function uploadImageHttpApiWebHandler(request: Request): Promise<Response> {
  return runUploadHandler(request, allowedImageMimeTypes, "image");
}

export async function uploadAttachmentHttpApiWebHandler(request: Request): Promise<Response> {
  return runUploadHandler(request, allowedAttachmentMimeTypes, "attachment");
}

export async function messageAttachmentHttpApiWebHandler(request: Request): Promise<Response> {
  const attachmentId = new URL(request.url).pathname.split("/").pop() ?? "";
  const outcome = await Effect.runPromise(
    getMessageAttachmentEffect(attachmentId).pipe(
      Effect.provide(UploadsLive),
      Effect.match({
        onFailure: (error) => ({ kind: "error" as const, error }),
        onSuccess: (attachment) => ({ kind: "ok" as const, attachment }),
      }),
    ),
  );

  if (outcome.kind === "error") return uploadJsonError(outcome.error);

  const { attachment } = outcome;
  const fileStream = createReadStream(path.resolve(attachment.filePath));
  return new Response(Readable.toWeb(fileStream) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": inlineAttachmentDisposition(attachment.originalName),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
