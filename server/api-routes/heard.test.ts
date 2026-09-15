import { describe, expect, it } from "vite-plus/test";
import { dispatchEffectApiRequest } from "./effect-api.ts";
import { buildSayToMeOpenApiSpec } from "./merged-api.ts";

const sessionId = `heard-slice-${crypto.randomUUID()}`;

describe("heard HTTP transport", () => {
  it("documents the Specter-backed heard routes", () => {
    const spec = buildSayToMeOpenApiSpec();
    expect(spec.paths["/api/sessions/{sessionId}/heard"]?.get?.operationId).toBe("heard.listHeard");
    expect(spec.paths["/api/sessions/{sessionId}/heard"]?.post?.operationId).toBe(
      "heard.recordHeard",
    );
  });

  it("records and lists heard receipts through the existing Effect API", async () => {
    const empty = await dispatchEffectApiRequest(
      new Request(`http://say.local/api/sessions/${sessionId}/heard`),
    );
    expect(empty).not.toBeNull();
    expect(empty!.status).toBe(200);
    expect(await empty!.json()).toEqual({ receipts: [] });

    const created = await dispatchEffectApiRequest(
      new Request(`http://say.local/api/sessions/${sessionId}/heard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: "42" }),
      }),
    );
    expect(created).not.toBeNull();
    expect(created!.status).toBe(201);
    const createdBody: unknown = await created!.json();
    expect(createdBody).toEqual({
      receipts: [expect.objectContaining({ messageId: "42" })],
    });

    const listed = await dispatchEffectApiRequest(
      new Request(`http://say.local/api/sessions/${sessionId}/heard`),
    );
    expect(listed).not.toBeNull();
    expect(await listed!.json()).toEqual(createdBody);
  });

  it("rejects an empty message id", async () => {
    const response = await dispatchEffectApiRequest(
      new Request(`http://say.local/api/sessions/${sessionId}/heard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: "" }),
      }),
    );
    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
  });
});
