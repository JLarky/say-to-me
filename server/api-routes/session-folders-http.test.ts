import { Effect, Layer } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { createCapabilityHttpHandler } from "../test-capability-http.ts";
import {
  buildSessionFoldersHandlers,
  SessionFoldersApi,
  SessionOrganization,
} from "./session-folders.ts";

const organization = { folders: [], placements: [] };
const testLayer = Layer.succeed(SessionOrganization, {
  get: () => Effect.succeed(organization),
  save: () => Effect.void,
});

const webHandler = createCapabilityHttpHandler({
  api: SessionFoldersApi,
  handlers: buildSessionFoldersHandlers(SessionFoldersApi),
  services: testLayer,
});

afterAll(() => webHandler.dispose());

describe("session folders HTTP contract", () => {
  it("serves only the capability API with a fake service", async () => {
    const response = await webHandler.handler(new Request("http://say.test/api/session-folders"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(organization);
  });

  it("rejects invalid organization payloads without touching DB", async () => {
    const response = await webHandler.handler(
      new Request("http://say.test/api/session-folders", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folders: "nope", placements: [] }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
