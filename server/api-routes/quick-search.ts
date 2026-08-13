import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { runQuickSearch } from "../quick-search.ts";
import { openApiDocs } from "./openapi-docs.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";

const QuickSearchQuery = Schema.Struct({
  q: Schema.optional(Schema.String),
  currentSpaceId: Schema.optional(Schema.String),
});

const QuickSearchMatchReason = Schema.Literal(
  "exact-id",
  "exact-alias",
  "exact-title",
  "exact-name",
  "id-prefix",
  "name-prefix",
  "alias-prefix",
  "title-prefix",
  "token-prefix",
  "substring-id",
  "substring-alias",
  "substring-title",
  "substring-cwd",
  "substring-name",
  "substring-context",
  "recent",
);

const QuickSearchSessionHit = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  alias: Schema.NullOr(Schema.String),
  state: Schema.String,
  archived: Schema.Boolean,
  ownerSpaceId: Schema.NullOr(Schema.String),
  ownerSpaceName: Schema.NullOr(Schema.String),
  href: Schema.String,
  matchReason: QuickSearchMatchReason,
});

const QuickSearchSpaceHit = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  context: Schema.String,
  href: Schema.String,
  matchReason: QuickSearchMatchReason,
});

const QuickSearchPayload = Schema.Struct({
  query: Schema.String,
  sessions: Schema.Array(QuickSearchSessionHit),
  spaces: Schema.Array(QuickSearchSpaceHit),
});

const QuickSearchError = Schema.Struct({
  error: Schema.String,
});

type QuickSearchRouteError = {
  _tag: "QuickSearchError";
  error: string;
  status: number;
};

export const quickSearchEffect = (
  rawQuery: string | undefined,
  currentSpaceId: string | undefined,
): Effect.Effect<Schema.Schema.Type<typeof QuickSearchPayload>, QuickSearchRouteError> =>
  Effect.try({
    try: () => runQuickSearch(rawQuery, currentSpaceId),
    catch: (e) => ({
      _tag: "QuickSearchError" as const,
      error: e instanceof Error ? e.message : String(e),
      status: 500,
    }),
  });

export const QuickSearchGroup = HttpApiGroup.make("quickSearch").add(
  HttpApiEndpoint.get("quickSearch", "/api/quick-search")
    .setUrlParams(QuickSearchQuery)
    .annotateContext(
      openApiDocs(
        "Quick search",
        "Searches spaces and sessions for the command-bar picker (optional currentSpaceId bias).",
      ),
    )
    .addSuccess(QuickSearchPayload)
    .addError(QuickSearchError, { status: 500 }),
);

export const QuickSearchApi = HttpApi.make("quickSearch").add(QuickSearchGroup);

export function buildQuickSearchHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    api as unknown as HttpApi.HttpApi<Id, typeof QuickSearchGroup, E, R>,
    "quickSearch",
    (handlers) =>
      handlers.handle("quickSearch", ({ urlParams }) =>
        quickSearchEffect(urlParams.q, urlParams.currentSpaceId).pipe(
          Effect.catchAll(publicRouteErrorResponse),
        ),
      ),
  );
}
