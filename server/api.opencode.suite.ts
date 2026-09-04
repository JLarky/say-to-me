import { type IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  type ApiSession,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  listen,
  mockOpenCode,
  createTestSession,
} from "./api.harness.ts";

describe("say API: opencode", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  it("treats an existing OpenCode session with no status map entry as idle", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    await createTestSession("ses_1dd864100ffes6uqv2NbJatAKt");
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.startsWith("/session/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
        return;
      }
      if (req.url?.startsWith("/session")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ id: "ses_1dd864100ffes6uqv2NbJatAKt" }]));
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const payload = await fetch(
        `${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`,
      ).then((response) => response.json());

      expect(payload.session.opencodeStatus).toBe("idle");
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("fetches OpenCode titles but not statuses for the homepage session list", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    await createTestSession("ses_1dd864100ffes6uqv2NbJatAKt");
    const openCode = await mockOpenCode((req, res) => {
      if (req.url?.includes("/session/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ id: { id: "ses_1dd864100ffes6uqv2NbJatAKt" }, title: "test session" }),
        );
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "status should not be called" }));
      }
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      await fetch(`${origin}/api/sessions/ses_1dd864100ffes6uqv2NbJatAKt/messages`);
      openCode.requests.length = 0;

      const payload = await fetch(`${origin}/api/sessions`).then((response) => response.json());

      expect(
        payload.sessions.some(
          (session: ApiSession) => session.id === "ses_1dd864100ffes6uqv2NbJatAKt",
        ),
      ).toBe(true);
      expect(
        payload.sessions.every((session: ApiSession) => !Object.hasOwn(session, "opencodeStatus")),
      ).toBe(true);
      // Titles are now fetched proactively for ses_* sessions
      const sesSessions = payload.sessions.filter((s: ApiSession) => s.id.startsWith("ses_"));
      expect(sesSessions.every((session: ApiSession) => session.opencodeTitle !== undefined)).toBe(
        true,
      );
      // Only title requests should have been made (no status requests)
      expect(openCode.requests.every((r: { url?: string }) => r.url?.includes("/session/"))).toBe(
        true,
      );

      openCode.requests.length = 0;
      const payloadWithStatus = await fetch(`${origin}/api/sessions?includeCachedStatus=1`).then(
        (response) => response.json(),
      );
      const sessionWithStatus = payloadWithStatus.sessions.find(
        (session: ApiSession) => session.id === "ses_1dd864100ffes6uqv2NbJatAKt",
      );
      expect(Object.hasOwn(sessionWithStatus, "opencodeStatus")).toBe(true);
      expect(openCode.requests.every((r: { url?: string }) => r.url?.includes("/session/"))).toBe(
        true,
      );
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });

  it("stops a pending OpenCode session through the SDK abort endpoint", async () => {
    const previousOpenCodeUrl = process.env.SAY_TO_ME_OPENCODE_URL;
    const sessionDirectory = "/tmp/stop-project";
    let abortRequest: IncomingMessage | undefined;
    const openCode = await mockOpenCode((req, res) => {
      if (
        req.url?.startsWith("/session/ses_ff19a11e43a24NwSk2Gx3LBAmy") &&
        !req.url.includes("/abort")
      ) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ id: "ses_ff19a11e43a24NwSk2Gx3LBAmy", directory: sessionDirectory }),
        );
        return;
      }
      if (req.url?.startsWith("/session/ses_ff19a11e43a24NwSk2Gx3LBAmy/abort")) {
        abortRequest = req;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
        return;
      }
      if (req.url?.startsWith("/session/status")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ses_ff19a11e43a24NwSk2Gx3LBAmy: { type: "idle" } }));
        return;
      }
      res.writeHead(404).end();
    });
    process.env.SAY_TO_ME_OPENCODE_URL = openCode.url;

    try {
      const response = await fetch(
        `${origin}/api/sessions/ses_ff19a11e43a24NwSk2Gx3LBAmy/stop-opencode`,
        {
          method: "POST",
        },
      );
      const payload = await response.json();

      expect(response.ok).toBe(true);
      expect(abortRequest?.url).toContain(
        `/session/ses_ff19a11e43a24NwSk2Gx3LBAmy/abort?directory=${encodeURIComponent(sessionDirectory)}`,
      );
      expect(payload.session.opencodeStatus).toBe("idle");
    } finally {
      process.env.SAY_TO_ME_OPENCODE_URL = previousOpenCodeUrl;
      openCode.server.close();
      server.close();
    }
  });
});
