import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { Context, Effect, Schema } from "effect";
import type { Organization, OrgFolder, OrgPlacement } from "../session-folders.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";
import { openApiDocs } from "./openapi-docs.ts";

// Service boundary (mirrors Notes/SessionMutations) so the route is testable
// with a fake layer and stays consistent with the rest of the API surface.
export type SessionOrganizationService = {
  get: () => Effect.Effect<Organization>;
  save: (input: Organization) => Effect.Effect<void>;
};

export const SessionOrganization = Context.GenericTag<SessionOrganizationService>(
  "say-to-me/SessionOrganization",
);

const OrganizationResult = Schema.Struct({
  folders: Schema.Array(Schema.Unknown),
  placements: Schema.Array(Schema.Unknown),
});

const SaveOrganizationPayload = Schema.Unknown;

const OrganizationSaved = Schema.Struct({ ok: Schema.Literal(true) });

const OrganizationError = Schema.Struct({
  _tag: Schema.Literal("OrganizationError"),
  error: Schema.String,
  status: Schema.Number,
});

type OrganizationError = Schema.Schema.Type<typeof OrganizationError>;

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This is the untrusted JSON object being parsed field-by-field by parseOrganization.
type OrganizationJsonObject = Record<string, unknown>;

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
function asRecord(value: unknown): OrganizationJsonObject | null {
  return value && typeof value === "object" ? (value as OrganizationJsonObject) : null;
}

// A folder chain that loops back on itself would make its subtree invisible on
// load and hang the client's parent-walks; reject any self-parent or cycle.
function hasCycle(folders: OrgFolder[]): boolean {
  const parentById = new Map(folders.map((f) => [f.id, f.parentId]));
  for (const folder of folders) {
    const seen = new Set<string>();
    let cursor: string | null | undefined = folder.id;
    while (cursor != null) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
  }
  return false;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
export function parseOrganization(payload: unknown): Organization | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.folders) || !Array.isArray(root.placements)) return null;

  const folders: OrgFolder[] = [];
  for (const raw of root.folders) {
    const f = asRecord(raw);
    if (!f || typeof f.id !== "string" || typeof f.name !== "string") return null;
    if (!Number.isFinite(f.sortOrder)) return null;
    const parentId = f.parentId == null ? null : typeof f.parentId === "string" ? f.parentId : null;
    folders.push({ id: f.id, name: f.name, parentId, sortOrder: f.sortOrder as number });
  }
  if (hasCycle(folders)) return null;

  const placements: OrgPlacement[] = [];
  for (const raw of root.placements) {
    const p = asRecord(raw);
    if (!p || typeof p.sessionId !== "string" || !Number.isFinite(p.sortOrder)) return null;
    const folderId = p.folderId == null ? null : typeof p.folderId === "string" ? p.folderId : null;
    placements.push({ sessionId: p.sessionId, folderId, sortOrder: p.sortOrder as number });
  }

  return { folders, placements };
}

function getOrganizationEffect(): Effect.Effect<Organization, never, SessionOrganizationService> {
  return Effect.flatMap(SessionOrganization, (service) => service.get());
}

function saveOrganizationEffect(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Untrusted input is narrowed by this boundary helper.
  payload: unknown,
): Effect.Effect<{ ok: true }, OrganizationError, SessionOrganizationService> {
  return Effect.gen(function* () {
    const parsed = parseOrganization(payload);
    if (!parsed) {
      return yield* Effect.fail({
        _tag: "OrganizationError" as const,
        error: "Expected { folders, placements } with finite sortOrders and no folder cycles.",
        status: 400,
      });
    }
    const service = yield* SessionOrganization;
    yield* service.save(parsed);
    return { ok: true as const };
  });
}

export const SessionFoldersGroup = HttpApiGroup.make("sessionFolders")
  .add(
    HttpApiEndpoint.get("getOrganization", "/api/session-folders")
      .annotateContext(
        openApiDocs(
          "Get session folders",
          "Returns the saved folder tree and session placements used to organize the session list.",
        ),
      )
      .addSuccess(OrganizationResult),
  )
  .add(
    HttpApiEndpoint.put("saveOrganization", "/api/session-folders")
      .setPayload(SaveOrganizationPayload)
      .annotateContext(
        openApiDocs(
          "Save session folders",
          "Persists folder definitions and session placements after validating sort order and cycles.",
        ),
      )
      .addSuccess(OrganizationSaved)
      .addError(OrganizationError, { status: 400 }),
  );

export const SessionFoldersApi = HttpApi.make("session-folders").add(SessionFoldersGroup);

export function buildSessionFoldersHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing SessionFoldersGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof SessionFoldersGroup, E, R>,
    "sessionFolders",
    (handlers) =>
      handlers
        .handle("getOrganization", () => getOrganizationEffect())
        .handle("saveOrganization", ({ payload }) =>
          saveOrganizationEffect(payload).pipe(Effect.catchAll(publicRouteErrorResponse)),
        ),
  );
}
