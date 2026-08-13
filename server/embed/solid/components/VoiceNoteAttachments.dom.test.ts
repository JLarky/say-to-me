/** @vitest-environment jsdom */
// @ts-expect-error -- Solid omits declarations for the direct browser runtime entry.
import { createRoot, createSignal } from "solid-js/dist/solid.js";
import { describe, expect, it } from "vite-plus/test";
import { VoiceNoteAttachments } from "./VoiceNoteAttachments.tsx";

const image = (id: number, originalName: string) => ({
  id,
  mimeType: "image/png",
  originalName,
  thumbnailDataUrl: "data:image/webp;base64,AAAA",
});

describe("VoiceNoteAttachments", () => {
  it("renders safe images in source order with exact link and accessible-name semantics", () => {
    const root = VoiceNoteAttachments({
      attachments: [
        {
          id: 1,
          mimeType: "audio/mpeg",
          originalName: "sound.mp3",
          thumbnailDataUrl: "data:image/png;base64,AAAA",
        },
        image(2, "first.png"),
        { id: 3, mimeType: "image/png", originalName: "missing.png", thumbnailDataUrl: "" },
        image(4, "second.png"),
      ],
    })!;
    const links = [...root.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://say.localhost:1311/api/message-attachments/2",
      "https://say.localhost:1311/api/message-attachments/4",
    ]);
    expect(
      links.every((link) => link.target === "_blank" && link.rel === "noopener noreferrer"),
    ).toBe(true);
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Open first.png",
      "Open second.png",
    ]);
    expect([...root.querySelectorAll("img")].map((image) => image.alt)).toEqual([
      "first.png",
      "second.png",
    ]);
  });

  it("ignores malformed entries and preserves the empty-list conditional", () => {
    expect(VoiceNoteAttachments({ attachments: [] })).toBeNull();
    const root = VoiceNoteAttachments({
      attachments: [
        null,
        "bad",
        { mimeType: "image/png", thumbnailDataUrl: "data:image/png;base64,AAAA" },
        image(5, "ok.png"),
      ],
    })!;
    expect(root.querySelectorAll("a")).toHaveLength(1);
    expect(root.querySelector("img")?.alt).toBe("ok.png");
  });
  it("reactively reconciles changed attachment filtering and order", async () => {
    let update: (value: ReadonlyArray<unknown>) => void = () => undefined;
    let dispose: () => void = () => undefined;
    const root = createRoot((cleanup: () => void) => {
      dispose = cleanup;
      const [attachments, setAttachments] = createSignal<ReadonlyArray<unknown>>([
        image(1, "initial.png"),
        { id: 9, mimeType: "audio/mpeg", originalName: "sound.mp3" },
      ]);
      update = setAttachments;
      return VoiceNoteAttachments({ attachments });
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root?.querySelectorAll("a")).toHaveLength(1);
    expect(root?.querySelector("img")?.alt).toBe("initial.png");
    update([
      image(3, "newer.png"),
      { id: 8, mimeType: "image/png", originalName: "bad.png", thumbnailDataUrl: "" },
      image(2, "old.png"),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect([...root!.querySelectorAll("img")].map((image) => image.alt)).toEqual([
      "newer.png",
      "old.png",
    ]);
    expect([...root!.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "https://say.localhost:1311/api/message-attachments/3",
      "https://say.localhost:1311/api/message-attachments/2",
    ]);
    dispose();
  });
});
