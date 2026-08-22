/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { isSessionListLiveSseEnabled, SESSION_LIST_SSE_FLAG_KEY } from "./session-list-live.ts";

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

describe("session list live transport flag", () => {
  it("defaults to polling (SSE off)", () => {
    expect(isSessionListLiveSseEnabled()).toBe(false);
  });

  it("enables SSE when localStorage flag is 1", () => {
    window.localStorage.setItem(SESSION_LIST_SSE_FLAG_KEY, "1");
    expect(isSessionListLiveSseEnabled()).toBe(true);
  });
});
