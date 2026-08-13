import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect } from "effect";

export type TaggedRouteError<Tag extends string = string> = {
  _tag: Tag;
  error: string;
  status: number;
};

export function publicRouteErrorResponse(error: TaggedRouteError) {
  return Effect.succeed(
    HttpServerResponse.unsafeJson({ error: error.error }, { status: error.status }),
  );
}
