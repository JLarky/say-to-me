/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  isSessionQueueMultiplexEnabled,
  SESSION_QUEUE_MULTIPLEX_FLAG_KEY,
  subscribeSessionQueueRealtime,
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

describe("session queue heartbeat", () => {
  it("forwards ping and open as ping events on the direct path", () => {
    const listeners = new Map<string, Set<(event: MessageEvent) => void>>();
    const instances: Array<{
      onopen: (() => void) | null;
      close: ReturnType<typeof vi.fn>;
    }> = [];

    class FakeEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();

      constructor(url: string) {
        expect(url).toBe("/api/sessions/vo_heartbeat/events");
        instances.push(this);
      }

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      }

      removeEventListener(type: string, listener: (event: MessageEvent) => void) {
        listeners.get(type)?.delete(listener);
      }
    }

    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("SharedWorker", undefined);

    const events: Array<{ eventType: string; data: string }> = [];
    const stop = subscribeSessionQueueRealtime("vo_heartbeat", {
      onEvent: (eventType, data) => events.push({ eventType, data }),
    });

    expect(instances).toHaveLength(1);
    instances[0]?.onopen?.();
    for (const listener of listeners.get("ping") ?? []) {
      listener({ data: "{}" } as MessageEvent);
    }

    expect(events).toEqual([
      { eventType: "ping", data: "" },
      { eventType: "ping", data: "{}" },
    ]);

    stop();
    expect(instances[0]?.close).toHaveBeenCalled();
  });
});
