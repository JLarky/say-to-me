import { describe, expect, it } from "vite-plus/test";
import { type SessionRuntimeLogEvent, createSessionRuntimeRegistry } from "./sessionRuntime.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Mirrors the concrete detail shapes passed to log(...) at each call site in sessionRuntime.ts.
type SessionRuntimeLogDetail =
  | { runtimeId: number }
  | { runtimeId: number; idleShutdownMs: number }
  | { runtimeId: number; status: string | null }
  | { runtimeId: number; attachedClients: number };

function makeRegistry(idleShutdownMs = 40) {
  const logs: Array<{
    event: SessionRuntimeLogEvent;
    sessionId: string;
    detail: SessionRuntimeLogDetail;
  }> = [];
  const registry = createSessionRuntimeRegistry({
    idleShutdownMs,
    log: (event, sessionId, detail) =>
      // SAFETY: sessionRuntime.ts's log() callback type declares detail as Record<string,
      // unknown>, but every call site only ever passes one of the SessionRuntimeLogDetail
      // shapes above; this test doesn't read detail's fields, only the event/sessionId.
      logs.push({ event, sessionId, detail: detail as SessionRuntimeLogDetail }),
  });
  return { logs, registry };
}

describe("session runtime registry", () => {
  it("reuses a warm runtime when a session reattaches before idle shutdown", async () => {
    const { logs, registry } = makeRegistry(80);
    try {
      const first = registry.attach("ses_ce16074ca6577EMEEHYZY9LR53");
      first.detach();
      await sleep(20);

      const second = registry.attach("ses_ce16074ca6577EMEEHYZY9LR53");
      expect(second.runtimeId).toBe(first.runtimeId);

      const inspection = registry.inspect("ses_ce16074ca6577EMEEHYZY9LR53");
      expect(inspection).toMatchObject({
        attachCount: 2,
        attachedClients: 1,
        detachCount: 1,
        idleRunning: false,
        phase: "warm",
      });
      expect(logs.map((entry) => entry.event)).toContain("idle-cancel");

      second.detach();
    } finally {
      registry.shutdown();
    }
  });

  it("disposes a runtime after the idle shutdown timer elapses", async () => {
    const { logs, registry } = makeRegistry(25);
    try {
      const handle = registry.attach("ses_2eeb31e92edcg4Hy12aa49tBGu");
      handle.detach();

      await sleep(70);

      expect(registry.inspect("ses_2eeb31e92edcg4Hy12aa49tBGu")).toBeNull();
      expect(logs.map((entry) => entry.event)).toContain("dispose");
    } finally {
      registry.shutdown();
    }
  });

  it("tracks the latest activity snapshot on a warm runtime", () => {
    const { registry } = makeRegistry();
    try {
      const handle = registry.attach("ses_9aea4816ddaclc4QvfMSp7stiO");
      handle.updateActivitySnapshot({ latestOutputSnippet: "working", status: "busy" });

      const inspection = registry.inspect("ses_9aea4816ddaclc4QvfMSp7stiO");
      expect(inspection?.latestActivitySnapshot).toMatchObject({
        latestOutputSnippet: "working",
        status: "busy",
      });
      expect(inspection?.latestActivityAt).toEqual(expect.any(Number));

      handle.detach();
    } finally {
      registry.shutdown();
    }
  });

  it("does not create an immortal runtime for snapshot-only activity updates", async () => {
    const { logs, registry } = makeRegistry(20);
    try {
      registry.updateActivitySnapshot("ses_ed385f33f7374c7VcqsItwotaV_only", { status: "idle" });

      expect(registry.inspect("ses_ed385f33f7374c7VcqsItwotaV_only")).toBeNull();
      expect(logs.map((entry) => entry.event)).not.toContain("create");

      await sleep(40);

      expect(registry.inspect("ses_ed385f33f7374c7VcqsItwotaV_only")).toBeNull();
    } finally {
      registry.shutdown();
    }
  });
});
