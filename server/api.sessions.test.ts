import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { Effect, Layer } from "effect";
import {
  type ApiSession,
  type TestServer,
  clearQueue,
  createApiMiddleware,
  createTestSession,
  listen,
  teardownApi,
  waitFor,
} from "./api.harness.ts";
import { dispatchEffectApiRequest } from "./api-routes/effect-api.ts";
import {
  SessionMutations,
  deleteSessionEffect,
  updateOpenCodeTitleEffect,
  updateSessionEffect,
  type SessionMutationService,
} from "./api-routes/sessions.ts";
import type { DbSession } from "./db/schemas.ts";

function fakeSession(id: string, state: DbSession["state"] = "general"): DbSession {
  return {
    id,
    state,
    alias: null,
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    opencodeProjectId: null,
    opencodeWorkspaceId: null,
    opencodeDirectory: null,
    opencodeWorktree: null,
    opencodePath: null,
    opencodeProjectName: null,
    opencodeBranch: null,
    opencodeSelectedModelProvider: null,
    opencodeSelectedModel: null,
  };
}

function sessionMutationLayer(service: Partial<SessionMutationService> = {}) {
  const calls: string[] = [];
  const base: SessionMutationService = {
    ensure: (sessionId) =>
      Effect.sync(() => {
        calls.push(`ensure:${sessionId}`);
        return fakeSession(sessionId);
      }),
    updateState: (sessionId, state) =>
      Effect.sync(() => {
        calls.push(`updateState:${sessionId}:${state}`);
      }),
    setCwd: (sessionId, cwd) =>
      Effect.sync(() => {
        calls.push(`setCwd:${sessionId}:${cwd}`);
      }),
    setAlias: (sessionId, alias) =>
      Effect.sync(() => {
        calls.push(`setAlias:${sessionId}:${alias ?? ""}`);
        return { ok: true as const };
      }),
    updateOpenCodeTitle: (sessionId, title) =>
      Effect.sync(() => {
        calls.push(`updateOpenCodeTitle:${sessionId}:${title}`);
        return { ok: true };
      }),
    deleteMessages: (sessionId) =>
      Effect.sync(() => {
        calls.push(`deleteMessages:${sessionId}`);
      }),
    deleteSession: (sessionId) =>
      Effect.sync(() => {
        calls.push(`deleteSession:${sessionId}`);
      }),
    broadcastQueue: (sessionId) =>
      Effect.sync(() => {
        calls.push(`broadcastQueue:${sessionId}`);
      }),
    broadcastSessions: () =>
      Effect.sync(() => {
        calls.push("broadcastSessions");
      }),
    addStatus: (session) =>
      Effect.sync(() => {
        calls.push(`addStatus:${session.id}`);
        return { ...session, opencodeStatus: "idle" };
      }),
  };
  return { calls, layer: Layer.succeed(SessionMutations, { ...base, ...service }) };
}

describe("session mutation effects", () => {
  it("updates session state through the injected service", async () => {
    const { calls, layer } = sessionMutationLayer();

    const result = await Effect.runPromise(
      updateSessionEffect("ses_20eed5bca8a6LbN9wlV1Hua5me", { state: "important" }).pipe(
        Effect.provide(layer),
      ),
    );

    expect(result.session).toMatchObject({
      id: "ses_20eed5bca8a6LbN9wlV1Hua5me",
      opencodeStatus: "idle",
    });
    expect(calls).toEqual([
      "ensure:ses_20eed5bca8a6LbN9wlV1Hua5me",
      "updateState:ses_20eed5bca8a6LbN9wlV1Hua5me:important",
      "broadcastQueue:ses_20eed5bca8a6LbN9wlV1Hua5me",
      "broadcastSessions",
      "ensure:ses_20eed5bca8a6LbN9wlV1Hua5me",
      "addStatus:ses_20eed5bca8a6LbN9wlV1Hua5me",
    ]);
  });

  it("updates session alias through the injected service", async () => {
    const { calls, layer } = sessionMutationLayer();

    const result = await Effect.runPromise(
      updateSessionEffect("cur_alias", { alias: "review bot" }).pipe(Effect.provide(layer)),
    );

    expect(result.session).toMatchObject({ id: "cur_alias", opencodeStatus: "idle" });
    expect(calls).toEqual([
      "ensure:cur_alias",
      "setAlias:cur_alias:review bot",
      "broadcastQueue:cur_alias",
      "broadcastSessions",
      "ensure:cur_alias",
      "addStatus:cur_alias",
    ]);
  });

  it("validates update payloads before touching the service", async () => {
    const { calls, layer } = sessionMutationLayer();

    await expect(
      Effect.runPromiseExit(
        updateSessionEffect("ses_20eed5bca8a6LbN9wlV1Hua5me", {}).pipe(Effect.provide(layer)),
      ),
    ).resolves.toMatchObject({
      _tag: "Failure",
      cause: {
        _tag: "Fail",
        error: {
          _tag: "SessionValidationError",
          error: "Session update must include state, cwd, or alias.",
          status: 400,
        },
      },
    });

    await expect(
      Effect.runPromiseExit(
        updateSessionEffect("ses_20eed5bca8a6LbN9wlV1Hua5me", { state: "snoozed" }).pipe(
          Effect.provide(layer),
        ),
      ),
    ).resolves.toMatchObject({
      _tag: "Failure",
      cause: {
        _tag: "Fail",
        error: {
          _tag: "SessionValidationError",
          error: "Invalid session state.",
          status: 400,
        },
      },
    });
    expect(calls).toEqual([]);
  });

  it("updates OpenCode titles through the injected service", async () => {
    const { calls, layer } = sessionMutationLayer();

    const result = await Effect.runPromise(
      updateOpenCodeTitleEffect("ses_5dfdabafcb34FqPXa7AGCdYtjJ", {
        title: "  Better title  ",
      }).pipe(Effect.provide(layer)),
    );

    expect(result.session).toMatchObject({
      id: "ses_5dfdabafcb34FqPXa7AGCdYtjJ",
      opencodeStatus: "idle",
    });
    expect(calls).toEqual([
      "ensure:ses_5dfdabafcb34FqPXa7AGCdYtjJ",
      "updateOpenCodeTitle:ses_5dfdabafcb34FqPXa7AGCdYtjJ:Better title",
      "broadcastQueue:ses_5dfdabafcb34FqPXa7AGCdYtjJ",
      "ensure:ses_5dfdabafcb34FqPXa7AGCdYtjJ",
      "addStatus:ses_5dfdabafcb34FqPXa7AGCdYtjJ",
    ]);
  });

  it("validates OpenCode title payloads before touching the service", async () => {
    const { calls, layer } = sessionMutationLayer();

    await expect(
      Effect.runPromiseExit(
        updateOpenCodeTitleEffect("ses_5dfdabafcb34FqPXa7AGCdYtjJ", { title: " " }).pipe(
          Effect.provide(layer),
        ),
      ),
    ).resolves.toMatchObject({
      _tag: "Failure",
      cause: {
        _tag: "Fail",
        error: {
          _tag: "SessionValidationError",
          error: "Title is required.",
          status: 400,
        },
      },
    });
    expect(calls).toEqual([]);
  });

  it("maps OpenCode title update failures to public route errors", async () => {
    const { calls, layer } = sessionMutationLayer({
      updateOpenCodeTitle: (sessionId, title) =>
        Effect.sync(() => {
          calls.push(`updateOpenCodeTitle:${sessionId}:${title}`);
          return { ok: false, status: 502, error: "Unable to update OpenCode session title." };
        }),
    });

    await expect(
      Effect.runPromiseExit(
        updateOpenCodeTitleEffect("ses_5dfdabafcb34FqPXa7AGCdYtjJ", { title: "Better title" }).pipe(
          Effect.provide(layer),
        ),
      ),
    ).resolves.toMatchObject({
      _tag: "Failure",
      cause: {
        _tag: "Fail",
        error: {
          _tag: "SessionUpstreamError",
          error: "Unable to update OpenCode session title.",
          status: 502,
        },
      },
    });
    expect(calls).toEqual([
      "ensure:ses_5dfdabafcb34FqPXa7AGCdYtjJ",
      "updateOpenCodeTitle:ses_5dfdabafcb34FqPXa7AGCdYtjJ:Better title",
    ]);
  });

  it("deletes non-default sessions through the injected service", async () => {
    const { calls, layer } = sessionMutationLayer();

    await expect(
      Effect.runPromise(
        deleteSessionEffect("ses_cdca0b2fd4dbxbccXiDaa9dNQe").pipe(Effect.provide(layer)),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      "deleteMessages:ses_cdca0b2fd4dbxbccXiDaa9dNQe",
      "deleteSession:ses_cdca0b2fd4dbxbccXiDaa9dNQe",
      "broadcastSessions",
    ]);
  });

  it("rejects deleting the default session before touching the service", async () => {
    const { calls, layer } = sessionMutationLayer();

    await expect(
      Effect.runPromiseExit(deleteSessionEffect("default").pipe(Effect.provide(layer))),
    ).resolves.toMatchObject({
      _tag: "Failure",
      cause: {
        _tag: "Fail",
        error: {
          _tag: "SessionValidationError",
          error: "Cannot delete default session.",
          status: 400,
        },
      },
    });
    expect(calls).toEqual([]);
  });

  it("registers session mutations in the Effect route table", async () => {
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_20eed5bca8a6LbN9wlV1Hua5me", {
          method: "PATCH",
        }),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_5dfdabafcb34FqPXa7AGCdYtjJ/opencode-title", {
          method: "PATCH",
        }),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_cdca0b2fd4dbxbccXiDaa9dNQe", {
          method: "DELETE",
        }),
      ),
    ).not.toBeNull();
    expect(
      await dispatchEffectApiRequest(
        new Request("http://say.local/api/sessions/ses_cdca0b2fd4dbxbccXiDaa9dNQe/messages", {
          method: "DELETE",
        }),
      ),
    ).toBeNull();
  });
});

describe("say API: sessions", () => {
  let server: TestServer;
  let origin: string;

  beforeEach(async () => {
    ({ server, origin } = await listen(createApiMiddleware()));
    await clearQueue(origin);
  });

  afterAll(async () => {
    await teardownApi();
  });

  it("updates session state", async () => {
    try {
      await createTestSession("ses_20eed5bca8a6LbN9wlV1Hua5me");
      const created = await fetch(
        `${origin}/api/sessions/ses_20eed5bca8a6LbN9wlV1Hua5me/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ author: "agent", text: "hello" }),
        },
      );
      expect(created.status).toBe(201);

      const updated = await fetch(`${origin}/api/sessions/ses_20eed5bca8a6LbN9wlV1Hua5me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "important" }),
      });
      const payload = await updated.json();
      expect(updated.status).toBe(200);
      expect(payload.session).toMatchObject({
        id: "ses_20eed5bca8a6LbN9wlV1Hua5me",
        state: "important",
      });

      const sessions = await fetch(`${origin}/api/sessions`).then((response) => response.json());
      expect(
        sessions.sessions.find(
          (session: ApiSession) => session.id === "ses_20eed5bca8a6LbN9wlV1Hua5me",
        )?.state,
      ).toBe("important");

      const invalid = await fetch(`${origin}/api/sessions/ses_20eed5bca8a6LbN9wlV1Hua5me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "snoozed" }),
      });
      expect(invalid.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("marks sessions as Jarvis-managed state", async () => {
    try {
      const updated = await fetch(`${origin}/api/sessions/ses_fd6abd6a0274HJ8BMhpfYXC0iy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "jarvis" }),
      });
      const payload = await updated.json();
      expect(updated.status).toBe(200);
      expect(payload.session).toMatchObject({
        id: "ses_fd6abd6a0274HJ8BMhpfYXC0iy",
        state: "jarvis",
      });

      const sessions = await fetch(`${origin}/api/sessions`).then((response) => response.json());
      expect(
        sessions.sessions.find(
          (session: ApiSession) => session.id === "ses_fd6abd6a0274HJ8BMhpfYXC0iy",
        )?.state,
      ).toBe("jarvis");
    } finally {
      server.close();
    }
  });

  it("returns monotonic revisions in session payloads", async () => {
    try {
      await createTestSession("ses_35979b4c30ddLUkvbNbMijaljW");
      await fetch(`${origin}/api/sessions/ses_35979b4c30ddLUkvbNbMijaljW/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "agent", text: "hello" }),
      });
      const first = await fetch(
        `${origin}/api/sessions/ses_35979b4c30ddLUkvbNbMijaljW/messages`,
      ).then((response) => response.json());

      await fetch(`${origin}/api/sessions/ses_35979b4c30ddLUkvbNbMijaljW`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "important" }),
      });
      const second = await fetch(
        `${origin}/api/sessions/ses_35979b4c30ddLUkvbNbMijaljW/messages`,
      ).then((response) => response.json());

      expect(first.revision).toBeGreaterThanOrEqual(1);
      expect(second.revision).toBeGreaterThan(first.revision);
      expect(second.session.revision).toBe(second.revision);
    } finally {
      server.close();
    }
  });

  it("only includes Jarvis overview details when requested", async () => {
    try {
      await createTestSession("ses_bf109876b72beJaicODNWcQu7x");
      await fetch(`${origin}/api/sessions/ses_bf109876b72beJaicODNWcQu7x/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author: "agent", text: "latest Jarvis summary" }),
      });

      const base = await fetch(`${origin}/api/sessions`).then((response) => response.json());
      const baseSession = base.sessions.find(
        (session: ApiSession) => session.id === "ses_bf109876b72beJaicODNWcQu7x",
      );
      expect(baseSession?.jarvisOverviewDetails).toBeUndefined();
      expect(baseSession?.latestMessageText).toBeUndefined();

      const jarvis = await fetch(`${origin}/api/sessions?jarvisOverviewDetails=1`).then(
        (response) => response.json(),
      );
      const jarvisSession = jarvis.sessions.find(
        (session: ApiSession & { jarvisOverviewDetails?: { latestMessageText?: string } }) =>
          session.id === "ses_bf109876b72beJaicODNWcQu7x",
      );
      expect(jarvisSession?.latestMessageText).toBeUndefined();
      expect(jarvisSession?.jarvisOverviewDetails?.latestMessageText).toBe("latest Jarvis summary");
    } finally {
      server.close();
    }
  });

  it("opens session event streams with revisioned snapshot events", async () => {
    let events: Response | undefined;

    try {
      events = await fetch(`${origin}/api/sessions/ses_68b12a650bb0PQ7O1hWPfvc4Bp/events`);
      expect(events.ok).toBe(true);
      const reader = events.body!.getReader();
      let chunk = "";
      while (!chunk.includes("event: snapshot")) {
        const { value } = await reader.read();
        chunk += new TextDecoder().decode(value);
      }
      await reader.cancel();

      expect(chunk).toContain("id: 0\n");
      expect(chunk).toContain("event: snapshot\n");
      expect(chunk).toContain('"revision":0');
    } finally {
      if (events?.body) await events.body.cancel().catch(() => {});
      server.close();
    }
  });

  it("tracks live agent reply listeners and clears presence on disconnect", async () => {
    let listener;

    try {
      listener = await fetch(`${origin}/api/sessions/default/agent-events`);

      await waitFor(async () => {
        const queue = await fetch(`${origin}/api/queue`).then((response) => response.json());
        return queue.presence.some(
          (item: { sessionId: string; agentListeners: number }) =>
            item.sessionId === "default" && item.agentListeners === 1,
        );
      });

      await listener.body!.cancel();

      await waitFor(async () => {
        const queue = await fetch(`${origin}/api/queue`).then((response) => response.json());
        return !queue.presence.some(
          (item: { sessionId: string; agentListeners: number }) => item.sessionId === "default",
        );
      });
    } finally {
      if (listener?.body) await listener.body.cancel().catch(() => {});
      server.close();
    }
  });

  it("attaches and clears an OpenCode session id on a conversation thread", async () => {
    try {
      const created = await fetch(`${origin}/say`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "agent" }),
      }).then((response) => response.json());

      const invalid = await fetch(`${origin}/api/messages/${created.message.id}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "bad-session" }),
      });
      const attached = await fetch(`${origin}/api/messages/${created.message.id}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "ses_1dd864100ffes6uqv2NbJatAKt" }),
      });
      const withSession = await fetch(`${origin}/api/queue`).then((response) => response.json());
      const cleared = await fetch(`${origin}/api/messages/${created.message.id}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "" }),
      });
      const withoutSession = await fetch(`${origin}/api/queue`).then((response) => response.json());

      expect(invalid.status).toBe(400);
      expect(attached.ok).toBe(true);
      expect(withSession.messages).toContainEqual(
        expect.objectContaining({
          id: created.message.id,
          attachedSessionId: "ses_1dd864100ffes6uqv2NbJatAKt",
        }),
      );
      expect(cleared.ok).toBe(true);
      expect(withoutSession.messages).toContainEqual(
        expect.objectContaining({ id: created.message.id, attachedSessionId: null }),
      );
    } finally {
      server.close();
    }
  });
});
