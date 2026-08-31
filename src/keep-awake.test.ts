/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createKeepAwake } from "./keep-awake.ts";

describe("keep-awake", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  it("requests a screen wake lock and releases it on stop", async () => {
    const sentinel = createSentinel();
    const request = vi.fn(async () => sentinel);

    const keepAwake = createKeepAwake({ requestWakeLock: request });
    await keepAwake.start();

    expect(request).toHaveBeenCalledTimes(1);
    expect(document.querySelector("video")).toBeNull();

    keepAwake.stop();
    expect(sentinel.release).toHaveBeenCalled();
  });

  it("still starts when wake lock is unavailable", async () => {
    const keepAwake = createKeepAwake({
      requestWakeLock: async () => null,
    });
    await expect(keepAwake.start()).resolves.toBeUndefined();
    expect(document.querySelector("video")).toBeNull();
    keepAwake.stop();
  });

  it("re-requests the wake lock when the tab becomes visible again", async () => {
    const sentinel = createSentinel();
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
    let visibilityState: DocumentVisibilityState = "visible";

    const keepAwake = createKeepAwake({ requestWakeLock: request });
    await keepAwake.start();
    expect(request).toHaveBeenCalledTimes(1);

    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(request).toHaveBeenCalledTimes(1);

    visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);

    keepAwake.stop();
  });
});

function createSentinel() {
  return {
    release: vi.fn(async () => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}
