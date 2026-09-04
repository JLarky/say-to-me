import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { dbDir } from "./config.ts";
import { messageAttachments, messages } from "./db/drizzle-schema.ts";
import { drizzleDb } from "./db/index.ts";
import { DbAttachment, validateDb } from "./db/schemas.ts";

export function serializeAttachment(attachment: DbAttachment) {
  return {
    ...attachment,
    url: `/api/message-attachments/${attachment.id}`,
  };
}

export async function buildThumbnailData(buffer: Buffer): Promise<{
  thumbnailDataUrl: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
}> {
  const image = sharp(buffer, { failOn: "none" }).resize({
    width: 100,
    height: 100,
    fit: "inside",
    withoutEnlargement: true,
  });
  const { data, info } = await image.webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  return {
    thumbnailDataUrl: `data:image/webp;base64,${data.toString("base64")}`,
    thumbnailWidth: info.width,
    thumbnailHeight: info.height,
  };
}

export function attachmentsByMessageId(
  filter?: string | { sessionId?: string; messageIds?: number[] },
): Map<number, ReturnType<typeof serializeAttachment>[]> {
  const where = (() => {
    if (!filter) return undefined;
    if (typeof filter === "string") return eq(messages.sessionId, filter);
    if (filter.messageIds && filter.messageIds.length > 0) {
      return inArray(messageAttachments.messageId, filter.messageIds);
    }
    if (filter.sessionId) return eq(messages.sessionId, filter.sessionId);
    return undefined;
  })();
  const rows = drizzleDb
    .select({
      id: messageAttachments.id,
      messageId: messageAttachments.messageId,
      filePath: messageAttachments.filePath,
      originalName: messageAttachments.originalName,
      mimeType: messageAttachments.mimeType,
      thumbnailDataUrl: messageAttachments.thumbnailDataUrl,
      thumbnailWidth: messageAttachments.thumbnailWidth,
      thumbnailHeight: messageAttachments.thumbnailHeight,
      createdAt: messageAttachments.createdAt,
    })
    .from(messageAttachments)
    .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
    .where(where)
    .orderBy(asc(messageAttachments.id))
    .all()
    .map((row) => validateDb(DbAttachment, row, "attachmentsForSession"));
  const grouped = new Map<number, ReturnType<typeof serializeAttachment>[]>();
  for (const row of rows) {
    const next = grouped.get(row.messageId) || [];
    next.push(serializeAttachment(row));
    grouped.set(row.messageId, next);
  }
  return grouped;
}

export function listAttachmentsForMessage(
  messageId: number,
): ReturnType<typeof serializeAttachment>[] {
  return drizzleDb
    .select({
      id: messageAttachments.id,
      messageId: messageAttachments.messageId,
      filePath: messageAttachments.filePath,
      originalName: messageAttachments.originalName,
      mimeType: messageAttachments.mimeType,
      thumbnailDataUrl: messageAttachments.thumbnailDataUrl,
      thumbnailWidth: messageAttachments.thumbnailWidth,
      thumbnailHeight: messageAttachments.thumbnailHeight,
      createdAt: messageAttachments.createdAt,
    })
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
    .orderBy(asc(messageAttachments.id))
    .all()
    .map((row) => validateDb(DbAttachment, row, "attachmentsForMessage"))
    .map(serializeAttachment);
}

export function getAttachment(attachmentId: number): DbAttachment | null {
  const row = drizzleDb
    .select({
      id: messageAttachments.id,
      messageId: messageAttachments.messageId,
      filePath: messageAttachments.filePath,
      originalName: messageAttachments.originalName,
      mimeType: messageAttachments.mimeType,
      thumbnailDataUrl: messageAttachments.thumbnailDataUrl,
      thumbnailWidth: messageAttachments.thumbnailWidth,
      thumbnailHeight: messageAttachments.thumbnailHeight,
      createdAt: messageAttachments.createdAt,
    })
    .from(messageAttachments)
    .where(eq(messageAttachments.id, attachmentId))
    .limit(1)
    .get();
  return row ? validateDb(DbAttachment, row, "getAttachment") : null;
}

export function insertAttachmentForMessage(
  messageId: number,
  attachment: {
    filePath: string;
    originalName: string;
    mimeType: string;
    thumbnailDataUrl: string;
    thumbnailWidth: number;
    thumbnailHeight: number;
  },
): void {
  drizzleDb
    .insert(messageAttachments)
    .values({
      messageId,
      filePath: attachment.filePath,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      thumbnailDataUrl: attachment.thumbnailDataUrl,
      thumbnailWidth: attachment.thumbnailWidth,
      thumbnailHeight: attachment.thumbnailHeight,
    })
    .run();
}

export function insertMarkdownAttachmentForMessage(messageId: number, markdown: string): void {
  const attachmentDir = path.join(dbDir, "attachments");
  mkdirSync(attachmentDir, { mode: 0o700, recursive: true });
  const filePath = path.join(attachmentDir, `${messageId}-${randomUUID()}.md`);
  writeFileSync(filePath, markdown, { mode: 0o600 });
  insertAttachmentForMessage(messageId, {
    filePath,
    originalName: "extra-markdown.md",
    mimeType: "text/markdown",
    thumbnailDataUrl: "",
    thumbnailWidth: 0,
    thumbnailHeight: 0,
  });
}

export const allowedImageMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
export const allowedAttachmentMimeTypes = new Set([...allowedImageMimeTypes, "audio/mpeg"]);

// Image temp roots: conventional /tmp plus os.tmpdir() (macOS /var/folders, or a
// TMPDIR-set sandbox). Longest first so the most specific nested root wins.
const tmpImageRoots = [...new Set(["/tmp", path.resolve(tmpdir())])].sort(
  (a, b) => b.length - a.length,
);

// The path.join(root, basename(...)) comparison requires a direct child and
// defeats traversal (e.g. /tmp/../etc/passwd collapses to a non-matching basename).
function isDirectTmpChild(filePath: string): boolean {
  return tmpImageRoots.some((root) => filePath === path.join(root, path.basename(filePath)));
}

const allowedImageExtensions = "(?:png|jpe?g|webp|gif)";
const allowedAttachmentExtensions = "(?:png|jpe?g|webp|gif|mp3)";
const tmpImageRootsAlternation = tmpImageRoots.map((root) => RegExp.escape(root)).join("|");

function inferImageMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return null;
}

function inferAttachmentMimeType(filePath: string): string | null {
  const imageMimeType = inferImageMimeType(filePath);
  if (imageMimeType) return imageMimeType;
  if (path.extname(filePath).toLowerCase() === ".mp3") return "audio/mpeg";
  return null;
}

export function isMp3Buffer(buffer: Buffer): boolean {
  if (buffer.length < 3) return false;
  if (buffer.subarray(0, 3).toString("ascii") === "ID3") return true;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

export function normalizeUploadFilename(name: string): string {
  const base = path.basename(name || "image");
  const safe = base
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return safe || "image";
}

function extensionForMimeType(mimeType: string): string | null {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "audio/mpeg") return ".mp3";
  return null;
}

const uuidAttachmentFilenamePattern = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.${allowedAttachmentExtensions}$`,
  "i",
);

export function validateClientUploadTargetPath(filePath: string, mimeType: string): string {
  const expectedExtension = extensionForMimeType(mimeType);
  if (!expectedExtension) throw new Error("Unsupported attachment type.");
  if (!isDirectTmpChild(filePath)) {
    throw new Error("Upload target must be a direct child of a temp directory (e.g. /tmp).");
  }
  if (!uuidAttachmentFilenamePattern.test(path.basename(filePath))) {
    throw new Error("Upload target must use a UUID filename with an allowed attachment extension.");
  }
  const actualExtension = path.extname(filePath).toLowerCase();
  if (
    actualExtension !== expectedExtension &&
    !(mimeType === "image/jpeg" && actualExtension === ".jpeg")
  ) {
    throw new Error("Upload target extension must match the uploaded attachment type.");
  }
  return filePath;
}

export type TmpAttachmentPath = {
  filePath: string;
  mimeType: string;
  originalName: string;
  thumbnailDataUrl: string;
  thumbnailWidth: number;
  thumbnailHeight: number;
};

export function validateTmpAttachmentPath(filePath: string): TmpAttachmentPath {
  if (!isDirectTmpChild(filePath)) {
    throw new Error("Attachment path must be a direct child of a temp directory (e.g. /tmp).");
  }
  if (!uuidAttachmentFilenamePattern.test(path.basename(filePath))) {
    throw new Error(
      "Attachment path must use a UUID filename with an allowed attachment extension.",
    );
  }
  if (!existsSync(filePath)) throw new Error(`Attachment file not found: ${filePath}`);
  const linkStats = lstatSync(filePath);
  if (linkStats.isSymbolicLink()) throw new Error(`Attachment may not be a symlink: ${filePath}`);
  const resolved = realpathSync(filePath);
  if (!isDirectTmpChild(resolved)) {
    throw new Error("Attachment real path must be a direct child of a temp directory (e.g. /tmp).");
  }
  const stats = statSync(filePath);
  if (!stats.isFile()) throw new Error(`Attachment is not a file: ${filePath}`);
  const mimeType = inferAttachmentMimeType(filePath);
  if (!mimeType) throw new Error(`Unsupported attachment type: ${filePath}`);
  return {
    filePath,
    mimeType,
    originalName: path.basename(filePath),
    thumbnailDataUrl: "",
    thumbnailWidth: 0,
    thumbnailHeight: 0,
  };
}

export const validateTmpImagePath = validateTmpAttachmentPath;

const tmpImagePathPattern = new RegExp(
  `(?:${tmpImageRootsAlternation})/[A-Za-z0-9._-]+\\.${allowedImageExtensions}`,
  "gi",
);
const tmpAttachmentPathPattern = new RegExp(
  `(?:${tmpImageRootsAlternation})/[A-Za-z0-9._-]+\\.${allowedAttachmentExtensions}`,
  "gi",
);

export function extractTmpImagePaths(text: string): string[] {
  const matches = text.match(tmpImagePathPattern) || [];
  return [...new Set(matches)];
}

export function extractTmpAttachmentPaths(text: string): string[] {
  const matches = text.match(tmpAttachmentPathPattern) || [];
  return [...new Set(matches)];
}

export function redactInlineAudioAttachmentPaths(text: string): string {
  return extractTmpAttachmentPaths(text).reduce(
    (nextText, filePath) =>
      path.extname(filePath).toLowerCase() === ".mp3"
        ? nextText.split(filePath).join("[audio attachment]")
        : nextText,
    text,
  );
}
