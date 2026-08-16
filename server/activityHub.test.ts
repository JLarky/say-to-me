import { describe, expect, it } from "vite-plus/test";

import {
  type ActivitySnapshot,
  type ActivitySignalHandlers,
  type ActivityListener,
  type ActivityHubConfig,
  createActivityHub,
} from "./activityHub.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const noopListener: ActivityListener = { onSnapshot: () => {}, onError: () => {} };

function makeFakeConfig(overrides: Partial<ActivityHubConfig> = {}) {
  let fetchCount = 0;
  let upstreamOpens = 0;
  let aborts = 0;
  const handlers: ActivitySignalHandlers[] = [];

  const config: ActivityHubConfig = {
    fetchSnapshot: async () => {
      fetchCount += 1;
      return { status: "idle", n: fetchCount };
    },
    openSignalSource: (_sessionId, h) => {
      upstreamOpens += 1;
      handlers.push(h);
      h.signal.addEventListener("abort", () => {
        aborts += 1;
      });
    },
    // Long poll by default so tests count only initial + signal-driven refetches.
    pollIntervalMs: 100_000,
    coalesceMs: 10,
    hotIdleMs: 20,
    warmGraceMs: 50,
    ...overrides,
  };

  return {
    config,
    stats: () => ({ fetchCount, upstreamOpens, aborts }),
    emitSignal: () => handlers.at(-1)?.onSignal(),
  };
}

describe("activity hub", () => {
  it("shares one upstream connection and one engine across multiple tabs", async () => {
    const { config, stats } = makeFakeConfig();
    const hub = createActivityHub(config);
    try {
      const a = hub.subscribe("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM", noopListener);
      const b = hub.subscribe("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM", noopListener);
      await sleep(10);

      expect(stats().upstreamOpens).toBe(1); // not multiplied per tab
      const inspection = hub.inspect("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM");
      expect(inspection?.clients).toBe(2);
      expect(inspection?.phase).toBe("LIVE");
      expect(inspection?.engineRunning).toBe(true);

      a();
      b();
    } finally {
      hub.shutdown();
    }
  });

  it("coalesces a burst of upstream signals into a single refetch", async () => {
    const { config, stats, emitSignal } = makeFakeConfig({ coalesceMs: 15 });
    const hub = createActivityHub(config);
    try {
      hub.subscribe("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM", noopListener);
      await sleep(10); // let the initial refetch settle
      const before = stats().fetchCount;

      emitSignal();
      emitSignal();
      emitSignal();
      emitSignal();
      await sleep(35); // > coalesceMs

      expect(stats().fetchCount - before).toBe(1);
    } finally {
      hub.shutdown();
    }
  });

  it("walks LIVE -> HOT_IDLE -> WARM_IDLE -> COLD as clients leave", async () => {
    const { config, stats } = makeFakeConfig({ hotIdleMs: 20, warmGraceMs: 50 });
    const hub = createActivityHub(config);
    try {
      const unsubscribe = hub.subscribe("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM", noopListener);
      await sleep(10);
      expect(hub.inspect("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM")?.phase).toBe("LIVE");

      unsubscribe(); // 0 clients

      // HOT_IDLE: engine (and upstream) kept warm, nothing aborted yet.
      await sleep(8);
      let inspection = hub.inspect("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM");
      expect(inspection?.phase).toBe("HOT_IDLE");
      expect(inspection?.engineRunning).toBe(true);
      expect(stats().aborts).toBe(0);

      // WARM_IDLE: upstream + poll torn down, cache retained.
      await sleep(20); // total ~28ms: past hotIdleMs(20), before warmGrace(50)
      inspection = hub.inspect("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM");
      expect(inspection?.phase).toBe("WARM_IDLE");
      expect(inspection?.engineRunning).toBe(false);
      expect(stats().aborts).toBe(1); // upstream aborted exactly once
      expect(inspection?.hasCachedSnapshot).toBe(true);

      // COLD: hub fully removed, no lingering fibers/timers.
      await sleep(35); // total ~63ms: past warmGrace(50)
      expect(hub.inspect("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM")).toBeNull();
    } finally {
      hub.shutdown();
    }
  });

  it("reconnect during HOT_IDLE reuses cache without reopening upstream", async () => {
    const { config, stats } = makeFakeConfig({ hotIdleMs: 30, warmGraceMs: 80 });
    const hub = createActivityHub(config);
    try {
      const first = hub.subscribe("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM", noopListener);
      await sleep(10);
      expect(stats().upstreamOpens).toBe(1);

      first(); // 0 clients -> HOT_IDLE
      await sleep(8);
      expect(hub.inspect("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM")?.phase).toBe("HOT_IDLE");

      let received: ActivitySnapshot | null = null;
      const second = hub.subscribe("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM", {
        onSnapshot: (snapshot) => {
          received = snapshot;
        },
        onError: () => {},
      });

      expect(received).not.toBeNull(); // cached snapshot served immediately
      expect(stats().upstreamOpens).toBe(1); // upstream NOT reopened
      expect(hub.inspect("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM")?.phase).toBe("LIVE");

      second();
    } finally {
      hub.shutdown();
    }
  });

  it("reconnect during WARM_IDLE reuses cache and revives the engine", async () => {
    const { config, stats } = makeFakeConfig({ hotIdleMs: 15, warmGraceMs: 80 });
    const hub = createActivityHub(config);
    try {
      const first = hub.subscribe("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM", noopListener);
      await sleep(10);
      first();

      // Wait into WARM_IDLE (engine torn down, cache only).
      await sleep(25);
      expect(hub.inspect("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM")?.phase).toBe("WARM_IDLE");
      expect(hub.inspect("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM")?.engineRunning).toBe(false);

      let received: ActivitySnapshot | null = null;
      const second = hub.subscribe("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM", {
        onSnapshot: (snapshot) => {
          received = snapshot;
        },
        onError: () => {},
      });

      expect(received).not.toBeNull(); // cache reused on revive (served synchronously)
      expect(hub.inspect("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM")?.phase).toBe("LIVE"); // revived immediately

      await sleep(10); // let the revived engine reach the upstream pump
      expect(stats().upstreamOpens).toBe(2); // engine restarted -> new upstream

      second();
    } finally {
      hub.shutdown();
    }
  });

  it("snapshot() reuses the warm cache and avoids an extra fetch", async () => {
    const { config, stats } = makeFakeConfig();
    const hub = createActivityHub(config);
    try {
      hub.subscribe("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM", noopListener);
      await sleep(10);
      const before = stats().fetchCount;

      const snap = await hub.snapshot("ses_6f7ff81a35dfGuQ6ZVL7cSlhhM");
      expect(snap).toBeTruthy();
      expect(stats().fetchCount).toBe(before); // served from cache, no new fetch
    } finally {
      hub.shutdown();
    }
  });

  it("supports polling-only providers without a signal source", async () => {
    let fetchCount = 0;
    const hub = createActivityHub({
      fetchSnapshot: async () => ({ status: "idle", n: ++fetchCount }),
      pollIntervalMs: 15,
      hotIdleMs: 20,
      warmGraceMs: 50,
    });
    try {
      const unsubscribe = hub.subscribe("codex_a", noopListener);
      await sleep(40);

      expect(fetchCount).toBeGreaterThanOrEqual(2);
      const inspection = hub.inspect("codex_a");
      expect(inspection).toMatchObject({
        clients: 1,
        engineRunning: true,
        phase: "LIVE",
      });

      unsubscribe();
    } finally {
      hub.shutdown();
    }
  });
});
