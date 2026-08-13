import { describe, expect, it } from "vite-plus/test";
import { composerSubmitIntent } from "./utils.ts";

const base = {
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  nativeEvent: { isComposing: false },
};

describe("composerSubmitIntent", () => {
  it("treats plain Enter as a normal send (queues when busy)", () => {
    expect(composerSubmitIntent({ ...base, key: "Enter" })).toBe("send");
  });

  it("treats Cmd+Enter as a force send", () => {
    expect(composerSubmitIntent({ ...base, key: "Enter", metaKey: true })).toBe("force");
  });

  it("treats Ctrl+Enter as a force send", () => {
    expect(composerSubmitIntent({ ...base, key: "Enter", ctrlKey: true })).toBe("force");
  });

  it("does not submit on Shift+Enter", () => {
    expect(composerSubmitIntent({ ...base, key: "Enter", shiftKey: true })).toBeNull();
  });

  it("does not submit while composing (IME)", () => {
    expect(
      composerSubmitIntent({ ...base, key: "Enter", nativeEvent: { isComposing: true } }),
    ).toBeNull();
  });

  it("ignores non-Enter keys", () => {
    expect(composerSubmitIntent({ ...base, key: "a" })).toBeNull();
  });
});
