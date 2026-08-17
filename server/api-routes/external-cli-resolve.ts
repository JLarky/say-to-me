import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Effect, Schema } from "effect";
import { resolveExternalCliSession } from "../external-cli/resolve-provider.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

const UuidPath = Schema.Struct({
  uuid: Schema.String.annotations({ description: "External CLI session UUID to resolve." }),
});
const ResolvePayload = Schema.Unknown;
const ResolveError = Schema.Struct({
  _tag: Schema.Literal("ResolveExternalCliError"),
  error: Schema.String,
  status: Schema.Number,
});
type ResolveError = Schema.Schema.Type<typeof ResolveError>;

export function resolveExternalCliEffect(rawUuid: string): Effect.Effect<unknown, ResolveError> {
  return Effect.sync(() => resolveExternalCliSession(rawUuid));
}

export const ExternalCliResolveGroup = HttpApiGroup.make("external-cli-resolve").add(
  HttpApiEndpoint.get("resolveExternalCli", "/api/external-cli/resolve/:uuid")
    .setPath(UuidPath)
    .annotateContext(
      openApiDocs(
        "Resolve external CLI session",
        "Looks up an external CLI session by UUID and returns its provider mapping.",
      ),
    )
    .addSuccess(ResolvePayload)
    .addError(ResolveError, { status: 400 }),
);

export function buildExternalCliResolveHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing ExternalCliResolveGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof ExternalCliResolveGroup, E, R>,
    "external-cli-resolve",
    (handlers) =>
      handlers.handle("resolveExternalCli", ({ path }) =>
        resolveExternalCliEffect(path.uuid).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
