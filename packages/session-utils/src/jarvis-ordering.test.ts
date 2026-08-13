import { describe, expect, it } from "vite-plus/test";
import {
  jarvisBucketForSession,
  jarvisCandidateSessions,
  jarvisManagedSessions,
  jarvisSections,
  jarvisWindowForSession,
  orderedJarvisSessions,
  type JarvisOrderingSession,
} from "./jarvis-ordering.ts";

describe("jarvis session ordering", () => {
  function session(overrides: Partial<JarvisOrderingSession>): JarvisOrderingSession {
    return {
      id: "ses_base",
      state: "general",
      updatedAt: "2026-06-14 10:00:00",
      ...overrides,
    };
  }

  it("groups sessions by activity window, then active, unknown, and idle status", () => {
    const now = new Date("2026-06-17T12:00:00Z").getTime();
    const active = session({
      id: "ses_active",
      jarvisOverviewDetails: {
        latestForwardStatus: "watching",
        latestMessageCreatedAt: "2026-06-17T11:30:00Z",
      },
    });
    const unknown = session({
      id: "ses_unknown",
      jarvisOverviewDetails: { latestMessageCreatedAt: "2026-06-17T11:20:00Z" },
      opencodeStatus: null,
    });
    const idle = session({
      id: "ses_idle",
      opencodeStatus: "idle",
      jarvisOverviewDetails: { latestMessageCreatedAt: "2026-06-17T11:10:00Z" },
    });
    const older = session({
      id: "ses_older",
      jarvisOverviewDetails: { latestMessageCreatedAt: "2026-05-01T12:00:00Z" },
    });

    expect(jarvisBucketForSession(active)).toBe("active");
    expect(jarvisBucketForSession(unknown)).toBe("unknown");
    expect(jarvisBucketForSession(idle)).toBe("idle");
    expect(jarvisWindowForSession(active, now)).toBe("lastHour");
    expect(jarvisWindowForSession(older, now)).toBe("last6Months");
    expect(
      orderedJarvisSessions([idle, unknown, older, active], now).map((item) => item.id),
    ).toEqual(["ses_active", "ses_idle", "ses_unknown", "ses_older"]);
    expect(jarvisSections([idle, unknown, older, active], now)).toEqual([
      expect.objectContaining({
        id: "lastHour",
        buckets: [
          expect.objectContaining({ id: "active", sessions: [active] }),
          expect.objectContaining({ id: "idle", sessions: [idle] }),
          expect.objectContaining({ id: "unknown", sessions: [unknown] }),
        ],
      }),
      expect.objectContaining({
        id: "last6Months",
        buckets: [expect.objectContaining({ id: "unknown", sessions: [older] })],
      }),
    ]);
  });

  it("splits explicitly managed Jarvis sessions from candidates", () => {
    const now = new Date("2026-06-17T12:00:00Z").getTime();
    const managed = session({ id: "ses_managed", state: "jarvis" });
    const candidate = session({ id: "ses_candidate", state: "important" });
    const archived = session({ id: "ses_archived", state: "archived" });

    expect(
      jarvisManagedSessions([candidate, managed, archived], now).map((item) => item.id),
    ).toEqual(["ses_managed"]);
    expect(
      jarvisCandidateSessions([candidate, managed, archived], now).map((item) => item.id),
    ).toEqual(["ses_candidate"]);
  });
});
