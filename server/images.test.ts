import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  extractTmpImagePaths,
  validateClientUploadTargetPath,
  validateTmpImagePath,
} from "./images.ts";

describe("image path validation", () => {
  it("accepts direct temp children with UUID image filenames", () => {
    const target = path.join(tmpdir(), "66666666-6666-4666-8666-666666666666.png");

    expect(validateClientUploadTargetPath(target, "image/png")).toBe(target);
  });

  it("rejects upload targets outside direct temp children", () => {
    expect(() =>
      validateClientUploadTargetPath("/etc/66666666-6666-4666-8666-666666666666.png", "image/png"),
    ).toThrow("direct child");
  });

  it("rejects mismatched upload MIME types", () => {
    expect(() =>
      validateClientUploadTargetPath(
        path.join(tmpdir(), "66666666-6666-4666-8666-666666666666.png"),
        "image/jpeg",
      ),
    ).toThrow("extension");
  });

  it("validates existing temp image attachment paths", () => {
    const imagePath = path.join(tmpdir(), "66666666-6666-4666-8666-666666666666.png");
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    try {
      expect(validateTmpImagePath(imagePath)).toMatchObject({
        filePath: imagePath,
        mimeType: "image/png",
        originalName: "66666666-6666-4666-8666-666666666666.png",
      });
    } finally {
      rmSync(imagePath, { force: true });
    }
  });

  it("extracts unique temp image paths from message text", () => {
    const imagePath = path.join(tmpdir(), "shot.png");

    expect(extractTmpImagePaths(`look ${imagePath}\nagain ${imagePath}`)).toEqual([imagePath]);
  });
});
