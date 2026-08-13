import { Effect, Schema } from "effect";
import type { DbSession } from "../db/schemas.ts";
import { addOpenCodeStatus } from "../opencode/client.ts";
import { workspacePathStatus } from "../workspace.ts";
import { publicRouteErrorResponse, type TaggedRouteError } from "./route-errors.ts";

export const OpenCodeSessionCreated = Schema.Struct({
  session: Schema.Unknown,
});

export type OpenCodeSessionCreated = Schema.Schema.Type<typeof OpenCodeSessionCreated>;

export function requireWritableWorkspacePathEffect<Tag extends string>(
  input: string,
  tag: Tag,
): Effect.Effect<string, TaggedRouteError<Tag>> {
  return Effect.gen(function* () {
    const status = workspacePathStatus(input);
    if (!status.ok) return yield* Effect.fail({ _tag: tag, error: status.error, status: 400 });
    if (!status.exists || !status.isDirectory || !status.writable) {
      return yield* Effect.fail({
        _tag: tag,
        error: "Path must exist and be a writable directory.",
        status: 400,
      });
    }
    return status.path;
  });
}

export function createOpenCodeSessionResponseEffect<Tag extends string>(
  createSession: () => Promise<
    { ok: true; session: DbSession } | { ok: false; status: number; error: string }
  >,
  upstreamTag: Tag,
): Effect.Effect<OpenCodeSessionCreated, TaggedRouteError<Tag>> {
  return Effect.gen(function* () {
    const created = yield* Effect.promise(createSession);
    if (!created.ok) {
      return yield* Effect.fail({
        _tag: upstreamTag,
        error: created.error,
        status: created.status,
      });
    }

    const session = yield* Effect.promise(() => addOpenCodeStatus(created.session));
    return { session };
  });
}

export function publicOpenCodeRouteErrorResponse(error: TaggedRouteError<string>) {
  return publicRouteErrorResponse(error);
}
