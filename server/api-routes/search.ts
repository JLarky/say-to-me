import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint";
import * as HttpApiGroup from "@effect/platform/HttpApiGroup";
import { inArray, like, or, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { messages as messagesTable, sessions as sessionsTable } from "../db/drizzle-schema.ts";
import { drizzleDb } from "../db/index.ts";
import { DbMessage, validateDb } from "../db/schemas.ts";
import { listSessions } from "../sessions.ts";
import { getCachedProviderTitle } from "../session-enrich.ts";
import { attachmentsByMessageId } from "../images.ts";
import { deserializeMessage } from "../messages.ts";
import { publicRouteErrorResponse } from "./route-errors.ts";

import { openApiDocs } from "./openapi-docs.ts";

const SearchQuery = Schema.Struct({
  q: Schema.optional(
    Schema.String.annotations({
      description: "Free-text query matched against session titles/aliases and message text.",
    }),
  ),
});

const SearchPayload = Schema.Struct({
  query: Schema.String,
  sessions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      alias: Schema.NullOr(Schema.String),
      title: Schema.NullOr(Schema.String),
      cwd: Schema.NullOr(Schema.String),
      state: Schema.String,
      href: Schema.String,
    }),
  ),
  messages: Schema.Array(
    Schema.Struct({
      id: Schema.Number,
      sessionId: Schema.String,
      text: Schema.String,
      extraMarkdown: Schema.NullOr(Schema.String),
      links: Schema.NullOr(Schema.Array(Schema.String)),
      author: Schema.String,
      createdAt: Schema.String,
      sessionAlias: Schema.NullOr(Schema.String),
      sessionTitle: Schema.NullOr(Schema.String),
      sessionCwd: Schema.NullOr(Schema.String),
    }),
  ),
});

const SearchRouteError = Schema.Struct({
  _tag: Schema.Literal("SearchRouteError"),
  error: Schema.String,
  status: Schema.Number,
});

type SearchRouteError = Schema.Schema.Type<typeof SearchRouteError>;

type SearchSession = {
  id: string;
  alias: string | null;
  title: string | null;
  cwd: string | null;
  state: string;
  href: string;
};

type SearchMessage = {
  id: number;
  sessionId: string;
  text: string;
  extraMarkdown: string | null;
  links: string[] | null;
  author: string;
  createdAt: string;
  sessionAlias: string | null;
  sessionTitle: string | null;
  sessionCwd: string | null;
};

function buildMessageHit(
  row: DbMessage,
  attachments: Map<number, any[]>,
  sessionAlias: string | null,
  sessionTitle: string | null,
  sessionCwd: string | null,
) {
  const deserialized = deserializeMessage(row, attachments.get(row.id) || [], new Map());
  return {
    id: deserialized.id,
    sessionId: row.sessionId,
    text: deserialized.text,
    extraMarkdown: deserialized.extraMarkdown ?? null,
    links: deserialized.links ?? null,
    author: deserialized.author,
    createdAt: deserialized.createdAt,
    sessionAlias,
    sessionTitle,
    sessionCwd,
  } satisfies SearchMessage;
}

export const searchEffect = (
  rawQuery: string | undefined,
): Effect.Effect<Schema.Schema.Type<typeof SearchPayload>, SearchRouteError> =>
  Effect.try({
    try: () => {
      const q = (rawQuery ?? "").trim();
      if (!q) {
        return { query: "", sessions: [], messages: [] };
      }

      const likeQ = `%${q}%`;

      // 1) Search messages by text, extraMarkdown, links (stored as JSON text)
      const messageRows = drizzleDb
        .select()
        .from(messagesTable)
        .where(
          or(
            like(messagesTable.text, likeQ),
            like(sql`coalesce(${messagesTable.extraMarkdown}, '')`, likeQ),
            like(sql`coalesce(${messagesTable.links}, '')`, likeQ),
          ),
        )
        .orderBy(sql`${messagesTable.id} DESC`)
        .limit(200)
        .all()
        .map((r) => validateDb(DbMessage, r, "searchMessages"));

      const messageSessionIds = Array.from(new Set(messageRows.map((r) => r.sessionId)));
      const sessionAliasById = new Map<string, string | null>();
      const sessionStateById = new Map<string, string>();
      const sessionTitleById = new Map<string, string | null>();
      const sessionCwdById = new Map<string, string | null>();

      if (messageSessionIds.length > 0) {
        const srows = drizzleDb
          .select({
            id: sessionsTable.id,
            alias: sessionsTable.alias,
            state: sessionsTable.state,
            cwd: sessionsTable.cwd,
          })
          .from(sessionsTable)
          .where(inArray(sessionsTable.id, messageSessionIds))
          .all();
        for (const r of srows) {
          sessionAliasById.set(r.id, r.alias ?? null);
          sessionStateById.set(r.id, r.state);
          sessionTitleById.set(r.id, getCachedProviderTitle(r.id));
          sessionCwdById.set(r.id, r.cwd ?? null);
        }
      }

      const attachments = attachmentsByMessageId({ messageIds: messageRows.map((r) => r.id) });
      const messageHits: SearchMessage[] = messageRows.map((row) =>
        buildMessageHit(
          row,
          attachments,
          sessionAliasById.get(row.sessionId) ?? null,
          sessionTitleById.get(row.sessionId) ?? null,
          sessionCwdById.get(row.sessionId) ?? null,
        ),
      );

      // 2) Search sessions by id, alias, and title (via list + enrich)
      const allSessions = listSessions();
      const sessionHits: SearchSession[] = [];
      for (const s of allSessions) {
        const title = s.opencodeTitle ?? getCachedProviderTitle(s.id) ?? null;
        const alias = s.alias ?? null;
        const cwd = s.cwd ?? null;
        const hay = [s.id, alias ?? "", title ?? "", cwd ?? ""].join(" ").toLowerCase();
        if (hay.includes(q.toLowerCase())) {
          sessionHits.push({
            id: s.id,
            alias,
            title,
            cwd,
            state: s.state,
            href: s.href ?? `/ses/${s.id}`,
          });
        }
      }

      // Also ensure any session that had matching messages is included even if title/id didn't match the string
      const missingFromHits = messageSessionIds.filter(
        (sid) => !sessionHits.some((h) => h.id === sid),
      );
      if (missingFromHits.length > 0) {
        const srows = drizzleDb
          .select({
            id: sessionsTable.id,
            alias: sessionsTable.alias,
            state: sessionsTable.state,
            cwd: sessionsTable.cwd,
          })
          .from(sessionsTable)
          .where(inArray(sessionsTable.id, missingFromHits))
          .all();
        for (const srow of srows) {
          sessionHits.push({
            id: srow.id,
            alias: srow.alias ?? null,
            title: sessionTitleById.get(srow.id) ?? null,
            cwd: srow.cwd ?? null,
            state: srow.state,
            href: `/ses/${srow.id}`,
          });
        }
      }

      // Dedup + sort by updated recency is already in listSessions order for the ones from list
      const seen = new Set<string>();
      const dedupedSessions = sessionHits.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });

      return {
        query: q,
        sessions: dedupedSessions,
        messages: messageHits,
      };
    },
    catch: (e) => ({
      _tag: "SearchRouteError" as const,
      error: e instanceof Error ? e.message : String(e),
      status: 500,
    }),
  });

export const SearchGroup = HttpApiGroup.make("search").add(
  HttpApiEndpoint.get("search", "/api/search")
    .setUrlParams(SearchQuery)
    .annotateContext(
      openApiDocs(
        "Search sessions and messages",
        "Finds sessions and messages matching the free-text query string.",
      ),
    )
    .addSuccess(SearchPayload)
    .addError(SearchRouteError, { status: 400 }),
);

export const SearchApi = HttpApi.make("search").add(SearchGroup);

export function buildSearchHandlers<
  Id extends string,
  Groups extends HttpApiGroup.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>) {
  return HttpApiBuilder.group(
    // @ts-expect-error SAFETY: Every caller passes the assembled API containing SearchGroup; Effect cannot express that group-membership constraint for arbitrary Groups.
    api as HttpApi.HttpApi<Id, typeof SearchGroup, E, R>,
    "search",
    (handlers) =>
      handlers.handle("search", ({ urlParams }) =>
        searchEffect(urlParams.q).pipe(Effect.catchAll(publicRouteErrorResponse)),
      ),
  );
}
