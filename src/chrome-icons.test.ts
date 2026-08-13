import { describe, expect, it } from "vite-plus/test";
import {
  isApplePlatform,
  isQuickSearchShortcutEvent,
  shortcutLabel,
  usesMetaQuickSearchShortcut,
} from "./components/page/chrome-icons.tsx";

describe("chrome-icons quick-search shortcut", () => {
  it("advertises Meta on Apple and Ctrl elsewhere", () => {
    expect(isApplePlatform("MacIntel")).toBe(true);
    expect(usesMetaQuickSearchShortcut("MacIntel")).toBe(true);
    expect(shortcutLabel("MacIntel")).toBe("⌘K");
    expect(usesMetaQuickSearchShortcut("Linux x86_64")).toBe(false);
    expect(shortcutLabel("Linux x86_64")).toBe("Ctrl+K");
  });

  it("accepts only the advertised modifier on each platform", () => {
    expect(
      isQuickSearchShortcutEvent(
        { key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBe(true);
    expect(
      isQuickSearchShortcutEvent(
        { key: "k", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        "MacIntel",
      ),
    ).toBe(false);
    expect(
      isQuickSearchShortcutEvent(
        { key: "k", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false },
        "Linux x86_64",
      ),
    ).toBe(true);
    expect(
      isQuickSearchShortcutEvent(
        { key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
        "Linux x86_64",
      ),
    ).toBe(false);
  });
});
