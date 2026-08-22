/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  isSessionQueueMultiplexEnabled,
  SESSION_QUEUE_MULTIPLEX_FLAG_KEY,
} from "./session-queue-realtime.ts";

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const memory = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    key() {
      return null;
    },
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("localStorage", memory);
  Object.defineProperty(window, "localStorage", { configurable: true, value: memory });
}

beforeEach(() => {
  installMemoryLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("session queue multiplex flag", () => {
  it("defaults to enabled", () => {
    expect(isSessionQueueMultiplexEnabled()).toBe(true);
  });

  it("disables when localStorage flag is 0", () => {
    window.localStorage.setItem(SESSION_QUEUE_MULTIPLEX_FLAG_KEY, "0");
    expect(isSessionQueueMultiplexEnabled()).toBe(false);
  });
});
