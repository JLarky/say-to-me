import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { listOpenCodeModels } from "../opencode/client.ts";
import {
  isAsyncProviderModels,
  listCliProviderModels,
  type ProviderModelsService,
} from "@say-to-me/provider-models";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const ProviderPath = Schema.Struct({
  providerName: Schema.String.annotations({
    description: "Provider name such as claude, codex, cursor, or grok.",
  }),
});

const ProviderModel = Schema.Struct({
  providerID: Schema.String,
  id: Schema.String,
  name: Schema.String,
});

const ProviderModelsListed = Schema.Struct({
  models: Schema.Array(ProviderModel),
});

type ProviderModelsListed = Schema.Schema.Type<typeof ProviderModelsListed>;

const ProviderModelsError = Schema.Struct({
  _tag: Schema.Literal("ProviderModelsError"),
  error: Schema.String,
  status: Schema.Number,
});

type ProviderModelsError = Schema.Schema.Type<typeof ProviderModelsError>;

function listProviderModelsEffect(
  providerName: string,
): Effect.Effect<ProviderModelsListed, ProviderModelsError, ProviderModelsService> {
  if (isAsyncProviderModels(providerName)) {
    return Effect.tryPromise({
      try: async () => {
        const models = await listOpenCodeModels();
        return {
          models: models.map((model) => ({
            providerID: model.providerID,
            id: model.id,
            name: model.name,
          })),
        };
      },
      catch: (error) => ({
        _tag: "ProviderModelsError" as const,
        error: error instanceof Error ? error.message : "Unable to load OpenCode models.",
        status: 502,
      }),
    });
  }

  return Effect.gen(function* () {
    const models = yield* listCliProviderModels(providerName);
    if (!models) {
      return yield* Effect.fail({
        _tag: "ProviderModelsError" as const,
        error: `Unknown provider: ${providerName}`,
        status: 400,
      });
    }
    return { models };
  });
}

export const ProviderModelsGroup = HttpApiGroup.make("provider-models").add(
  HttpApiEndpoint.get("listProviderModels", "/api/providers/:providerName/models")
    .setPath(ProviderPath)
    .annotateContext(
      openApiDocs(
        "List provider models",
        "Returns the known model catalog for a provider such as claude, codex, cursor, or grok.",
      ),
    )
    .addSuccess(ProviderModelsListed)
    .addError(ProviderModelsError, { status: 400 })
    .addError(ProviderModelsError, { status: 502 }),
);

export function buildProviderModelsHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing ProviderModelsGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof ProviderModelsGroup, E, R>,
    "provider-models",
    (handlers) =>
      handlers.handle("listProviderModels", ({ path }) =>
        listProviderModelsEffect(path.providerName).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
