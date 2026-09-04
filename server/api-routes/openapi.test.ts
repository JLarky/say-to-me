import { describe, expect, it } from "vite-plus/test";
import { dispatchEffectApiRequest } from "./effect-api.ts";
import { buildSayToMeOpenApiSpec } from "./merged-api.ts";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- OpenAPI Schema Objects allow vendor-defined properties; these tests inspect only standard fields.
type OpenApiSchemaProperties = Record<string, unknown>;

describe("live OpenAPI publication", () => {
  it("builds an OpenAPI 3.1 document from SayToMeApi", () => {
    const spec = buildSayToMeOpenApiSpec();
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Say To Me");
    expect(spec.info.version).toBe("0.1.0");
    expect(spec.paths["/api/health"]?.get?.operationId).toBe("health.getHealth");
    expect(Object.keys(spec.paths ?? {}).length).toBeGreaterThan(10);
  });

  it("serves GET /openapi.json from the Effect web handler", async () => {
    const response = await dispatchEffectApiRequest(new Request("http://say.local/openapi.json"));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get("content-type") ?? "").toMatch(/json/i);

    const body: unknown = await response!.json();
    expect(body).toEqual(expect.objectContaining({ openapi: "3.1.0" }));
    const paths = (body as { paths?: OpenApiSchemaProperties }).paths;
    expect(paths).toBeDefined();
    expect(paths!["/api/health"]).toBeDefined();
  });

  it("keeps existing Effect routes working alongside openapi.json", async () => {
    const response = await dispatchEffectApiRequest(new Request("http://say.local/api/health"));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
  });

  it("documents message-create public {error} shapes for 400 and 500", () => {
    const spec = buildSayToMeOpenApiSpec();
    const operation = spec.paths["/api/sessions/{sessionId}/messages"]?.post;
    expect(operation?.operationId).toBe("message-create.createSessionMessage");

    const responses = operation?.responses ?? {};
    expect(Object.keys(responses).sort()).toEqual(expect.arrayContaining(["400", "500"]));

    for (const status of ["400", "500"] as const) {
      const errorSchema = responses[status]?.content?.["application/json"]?.schema as {
        anyOf?: unknown[];
        type?: string;
        required?: string[];
        properties?: OpenApiSchemaProperties;
      };
      const publicError =
        errorSchema?.anyOf?.find(
          (candidate): candidate is { required?: string[]; properties?: OpenApiSchemaProperties } =>
            Boolean(
              candidate &&
              typeof candidate === "object" &&
              Array.isArray((candidate as { required?: string[] }).required) &&
              (candidate as { required?: string[] }).required?.includes("error") &&
              !(candidate as { required?: string[] }).required?.includes("_tag"),
            ),
        ) ?? errorSchema;
      expect(publicError?.required).toEqual(["error"]);
      expect(publicError?.properties).toEqual({ error: { type: "string" } });
      expect(JSON.stringify(publicError)).not.toContain("MessageCreateError");
      expect(JSON.stringify(publicError)).not.toContain('"_tag"');
      expect(JSON.stringify(publicError)).not.toContain('"status"');
    }
  });

  it("documents dashboard-placement success and public {error} shapes", () => {
    const spec = buildSayToMeOpenApiSpec();
    const operation = spec.paths["/api/sessions/{sessionId}/dashboard-placement"]?.get;
    expect(operation?.operationId).toBe("sessions.dashboardPlacement");

    const responses = operation?.responses ?? {};
    expect(Object.keys(responses).sort()).toEqual(["200", "400", "404"]);

    const successSchema = responses["200"]?.content?.["application/json"]?.schema as {
      type?: string;
      required?: string[];
      properties?: OpenApiSchemaProperties;
      $id?: string;
      title?: string;
    };
    expect(successSchema?.type).toBe("object");
    expect(successSchema?.$id).toBeUndefined();
    expect(successSchema?.title).not.toBe("unknown");
    expect(successSchema?.required).toEqual(
      expect.arrayContaining([
        "sessionId",
        "title",
        "cwd",
        "ownerSpaceId",
        "placementPossible",
        "placementBlockReason",
        "needsChooser",
        "chooserMode",
        "discovered",
        "preview",
      ]),
    );
    expect(successSchema?.properties?.sessionId).toEqual({ type: "string" });
    expect(successSchema?.properties?.preview).toEqual(
      expect.objectContaining({
        type: "object",
        required: expect.arrayContaining([
          "targetSpaceId",
          "wouldAttachRepository",
          "wouldAttachWorktree",
          "warnings",
        ]),
      }),
    );

    for (const status of ["400", "404"] as const) {
      const errorSchema = responses[status]?.content?.["application/json"]?.schema as {
        anyOf?: unknown[];
        type?: string;
        required?: string[];
        properties?: OpenApiSchemaProperties;
      };
      // Prefer the declared public body when decode errors share the status.
      const publicError =
        errorSchema?.anyOf?.find(
          (candidate): candidate is { required?: string[]; properties?: OpenApiSchemaProperties } =>
            Boolean(
              candidate &&
              typeof candidate === "object" &&
              Array.isArray((candidate as { required?: string[] }).required) &&
              (candidate as { required?: string[] }).required?.includes("error") &&
              !(candidate as { required?: string[] }).required?.includes("_tag"),
            ),
        ) ?? errorSchema;
      expect(publicError?.required).toEqual(["error"]);
      expect(publicError?.properties).toEqual({ error: { type: "string" } });
      expect(JSON.stringify(publicError)).not.toContain("SessionValidationError");
      expect(JSON.stringify(publicError)).not.toContain('"_tag"');
    }
  });

  it("documents routines public {error} shapes for 400, 404, 409, and 500", () => {
    const spec = buildSayToMeOpenApiSpec();
    const operations = [
      spec.paths["/api/routines"]?.get,
      spec.paths["/api/routines"]?.post,
      spec.paths["/api/routines/{id}"]?.patch,
      spec.paths["/api/routines/{id}"]?.delete,
      spec.paths["/api/routines/{id}/actions"]?.post,
    ];

    for (const operation of operations) {
      expect(operation?.operationId).toMatch(/^routines\./);
      const responses = operation?.responses ?? {};
      expect(Object.keys(responses)).toEqual(expect.arrayContaining(["400", "404", "409", "500"]));

      for (const status of ["400", "404", "409", "500"] as const) {
        const errorSchema = responses[status]?.content?.["application/json"]?.schema as {
          anyOf?: unknown[];
          type?: string;
          required?: string[];
          properties?: Record<string, unknown>;
        };
        const publicError =
          errorSchema?.anyOf?.find(
            (
              candidate,
            ): candidate is { required?: string[]; properties?: Record<string, unknown> } =>
              Boolean(
                candidate &&
                typeof candidate === "object" &&
                Array.isArray((candidate as { required?: string[] }).required) &&
                (candidate as { required?: string[] }).required?.includes("error") &&
                !(candidate as { required?: string[] }).required?.includes("_tag"),
              ),
          ) ?? errorSchema;
        expect(publicError?.required).toEqual(["error"]);
        expect(publicError?.properties).toEqual({ error: { type: "string" } });
        expect(JSON.stringify(publicError)).not.toContain('"_tag"');
        expect(JSON.stringify(publicError)).not.toContain('"status"');
      }
    }
  });
});
