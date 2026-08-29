/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createNotificationsFanOut,
  formatNotificationsRealtimeHint,
  MULTI_TAB_CAPACITY_NOTICE,
  SHARED_NOTIFICATIONS_FLAG_KEY,
} from "./notifications-realtime-protocol.ts";
import {
  isSharedNotificationsWorkerEnabled,
  subscribeNotificationsRealtime,
} from "./notifications-realtime.ts";

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
    key(index: number) {
      return [...store.keys()][index] ?? null;
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

describe("notifications fan-out", () => {
  it("fans events to every connected port and tracks client count", () => {
    const hub = createNotificationsFanOut();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const portA = { postMessage: (data: unknown) => a.push(data) };
    const portB = { postMessage: (data: unknown) => b.push(data) };

    expect(hub.addPort(portA)).toBe(1);
    expect(hub.addPort(portB)).toBe(2);

    hub.fanEvent("snapshot", '{"notifications":[]}');
    expect(a).toEqual([{ type: "event", eventType: "snapshot", data: '{"notifications":[]}' }]);
    expect(b).toEqual([{ type: "event", eventType: "snapshot", data: '{"notifications":[]}' }]);
    expect(hub.getLastEvent()?.data).toBe('{"notifications":[]}');

    expect(hub.removePort(portA)).toBe(1);
    hub.broadcastStatus("shared", hub.getClientCount());
    expect(b.at(-1)).toEqual({ type: "status", mode: "shared", clientCount: 1 });
  });

  it("keeps connecting status when the upstream is reconnecting", () => {
    const hub = createNotificationsFanOut();
    const messages: unknown[] = [];
    hub.addPort({ postMessage: (data: unknown) => messages.push(data) });
    hub.broadcastStatus("connecting", hub.getClientCount(), "upstream reconnecting");
    expect(messages.at(-1)).toEqual({
      type: "status",
      mode: "connecting",
      clientCount: 1,
      error: "upstream reconnecting",
    });
  });

  it("drops ports that throw on postMessage", () => {
    const hub = createNotificationsFanOut();
    const healthy: unknown[] = [];
    hub.addPort({
      postMessage() {
        throw new Error("dead");
      },
    });
    hub.addPort({ postMessage: (data: unknown) => healthy.push(data) });
    hub.fanEvent("message", "x");
    expect(hub.getClientCount()).toBe(1);
    expect(healthy).toHaveLength(1);
  });
});

describe("shared notifications flag and fallback", () => {
  it("disables the SharedWorker path when localStorage flag is 0", () => {
    window.localStorage.setItem(SHARED_NOTIFICATIONS_FLAG_KEY, "0");
    expect(isSharedNotificationsWorkerEnabled()).toBe(false);
  });

  it("falls back to a direct EventSource when SharedWorker is missing", () => {
    const listeners = new Map<string, Set<(event: MessageEvent) => void>>();
    const instances: Array<{ close: ReturnType<typeof vi.fn> }> = [];

    class FakeEventSource {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();

      constructor(url: string) {
        expect(url).toBe("/api/notifications/events");
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
    const stop = subscribeNotificationsRealtime({
      onEvent: (eventType, data) => events.push({ eventType, data }),
    });

    expect(instances).toHaveLength(1);
    const snapshotListeners = listeners.get("snapshot");
    expect(snapshotListeners?.size).toBe(1);
    for (const listener of snapshotListeners ?? []) {
      listener({ data: '{"notifications":[]}' } as MessageEvent);
    }
    expect(events).toEqual([{ eventType: "snapshot", data: '{"notifications":[]}' }]);

    stop();
    expect(instances[0]?.close).toHaveBeenCalled();
  });
  it("cleans up safely when EventSource double omits removeEventListener", () => {
    class IncompleteEventSource {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      addEventListener() {}
      close = vi.fn();
    }

    vi.stubGlobal("EventSource", IncompleteEventSource);
    vi.stubGlobal("SharedWorker", undefined);

    const stop = subscribeNotificationsRealtime({
      onEvent: () => {},
    });

    expect(() => stop()).not.toThrow();
  });

  it("runs onError when the shared worker reports an upstream reconnect", () => {
    const workers: Array<{
      port: {
        onmessage: ((event: MessageEvent) => void) | null;
        close: ReturnType<typeof vi.fn>;
      };
    }> = [];

    class FakeSharedWorker {
      port = {
        onmessage: null as ((event: MessageEvent) => void) | null,
        onmessageerror: null as (() => void) | null,
        start() {},
        close: vi.fn(),
        postMessage() {},
      };
      onerror: (() => void) | null = null;

      constructor() {
        workers.push(this);
      }
    }

    vi.stubGlobal("SharedWorker", FakeSharedWorker);

    const onError = vi.fn();
    const stop = subscribeNotificationsRealtime({
      onEvent: () => {},
      onError,
    });

    expect(workers).toHaveLength(1);
    workers[0]?.port.onmessage?.({
      data: {
        type: "status",
        mode: "connecting",
        clientCount: 1,
        error: "upstream reconnecting",
      },
    } as MessageEvent);

    expect(onError).toHaveBeenCalledTimes(1);
    stop();
  });
});

describe("multi-tab capacity copy", () => {
  it("explains delayed tabs and closing unused STM tabs", () => {
    expect(MULTI_TAB_CAPACITY_NOTICE).toContain("realtime connections are busy");
    expect(MULTI_TAB_CAPACITY_NOTICE).toContain("close an unused Say To Me tab");
    expect(MULTI_TAB_CAPACITY_NOTICE).toContain("Untitled");
  });

  it("formats shared and direct status hints", () => {
    expect(formatNotificationsRealtimeHint({ mode: "shared", clientCount: 3, error: null })).toBe(
      "Realtime notifications: shared across 3 clients.",
    );
    expect(
      formatNotificationsRealtimeHint({ mode: "direct", clientCount: 1, error: null }),
    ).toContain("direct connection");
  });
});
