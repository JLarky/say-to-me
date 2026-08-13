# Session Titles & Labels

This document specifies how sessions are named across Say To Me: list/organize labels, the session page hero, organize breadcrumbs, and the provider title line.

Implementation lives in:

- `src/session-display.ts` — label resolution
- `src/session-label.ts` — client helpers (`sessionListLabel`, etc.)
- `src/components/SessionLabel.tsx` — list label presenters
- `src/session-organize-path.ts` — organize breadcrumb path
- `src/components/OrganizePathBreadcrumbs.tsx` — breadcrumb UI
- `src/pages/_SessionPage.tsx` — session page hero layout
- `server/session-enrich.ts` — tier 0/1 server enrichment
- `server/session-folders.ts` — `organizePath` on session payloads
- `server/opencode/client.ts` — tier 2 live `opencodeTitle` enrichment

## Naming layers

A session has up to three independent naming layers:

| Layer              | Storage                                           | Editable where                                | Purpose                                            |
| ------------------ | ------------------------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| **Alias**          | SQLite `sessions.alias`                           | Session page hero (line 1), Organize → Rename | User-chosen display name for Say To Me             |
| **Provider title** | External (OpenCode API, Cursor meta, Claude meta) | Session page line 2 (OpenCode `ses_*` only)   | Title from the agent backend                       |
| **Workspace / id** | SQLite `sessions.cwd`, session id                 | Not directly editable as a label              | Fallback when alias and provider title are missing |

These layers are **not** merged into one string except at display time. The session page intentionally shows multiple layers at once so users can see both “what I call it” (alias) and “what the provider calls it” (provider title).

## Resolver functions

All label logic should go through `src/session-display.ts`.

### Shared fallback (no alias)

When no alias is set:

```
providerTitle ?? workspaceBasename(cwd) ?? id
```

- **Provider title** — `session.opencodeTitle` after server enrichment (see below).
- **Workspace basename** — last path segment of `cwd` (e.g. `/Users/me/say-to-me` → `say-to-me`).
- **Id** — raw session id (`cur_…`, `ses_…`, etc.). The special id `default` displays as `default`.

### `resolveListDisplayName`

Used for home list, Jarvis, organize tree rows, notifications, document title, etc.

```
alias ?? providerTitle ?? workspaceBasename(cwd) ?? id
```

One line — pick the best single label for scanning a list.

### `resolveSessionPageIdentityLabel` (session page line 1)

Same chain as `resolveListDisplayName`:

```
alias ?? providerTitle ?? workspaceBasename(cwd) ?? id
```

Rendered as the large hero `<h1>`. Click → pencil → inline alias editor (`PATCH /api/sessions/:id` with `{ alias }`). Clearing the alias sends `null` and line 1 falls back to provider title / cwd / id.

### `resolveProviderTitleLabel` (session page line 2)

Always the provider layer, **ignoring alias**:

```
providerTitle ?? workspaceBasename(cwd) ?? id
```

Rendered in smaller text below the hero. Always shown when non-empty, even if it matches line 1 (both layers visible).

OpenCode sessions (`ses_*`) only: click line 2 → pencil → inline editor (`PATCH /api/sessions/:id/opencode-title`). Cursor / Claude / Codex ids do not get this pencil; their provider title is read-only from local meta or API.

## Provider title (`opencodeTitle`)

Despite the field name, `opencodeTitle` is the **computed provider title** for all backends. Set in `addOpenCodeStatus`:

| Session id pattern | Source                                  |
| ------------------ | --------------------------------------- |
| `ses_*`            | OpenCode session API `title`            |
| `cur_*`            | Cursor chat meta file `title`           |
| `cc_*`             | Claude meta title helper                |
| Other              | OpenCode API when applicable, else null |

`cwd` comes from the DB and is used only when provider title is null.

## Session page layout

```
┌─────────────────────────────────────────────────────────────┐
│ [⌂]  Home / workspace / tmp     Links  Cursor busy  …     │  ← eyebrow row
├─────────────────────────────────────────────────────────────┤
│ Page Organizer                                              │  ← line 1: identity (alias or fallback)
│ Page Organizer   [cur_9c7…31]  ✎?                         │  ← line 2: provider title + mention copy (+ OpenCode ✎)
│ + Add note                                                  │
└─────────────────────────────────────────────────────────────┘
```

### Eyebrow row

- **Home icon** (`⌂`) — links to `/` (session list).
- **Organize breadcrumbs** — `OrganizePathBreadcrumbs`, rendered via `PageShell` `eyebrowLead`.
- **No “Session” label** — breadcrumbs and title carry context; the uppercase eyebrow is omitted on the session page.
- Status controls (Links, stop buttons, live updates) follow in the same row.

### Line 1 — identity

- Source: `resolveSessionPageIdentityLabel`.
- Style: large hero title (`sessionStyles.heroTitle`).
- Edit: alias only, any non-`default` session.

### Line 2 — provider title + mention

- Provider text: `resolveProviderTitleLabel`.
- **Copy button** — shows shortened session id; copies `say-to-me(id)` or `say-to-me(id, alias)` via `sessionMentionToken`.
- **OpenCode pencil** — only for `ses_*` ids; edits provider title, not alias.

## Organize breadcrumbs

Breadcrumbs show where the session lives in the Organize folder tree. They appear in the **eyebrow row**, not in the hero title.

### Path resolution

`resolveOrganizePathForSession(sessionId, folders, placements)` in `src/session-organize-path.ts`:

| Placement                             | Breadcrumbs                                                     |
| ------------------------------------- | --------------------------------------------------------------- |
| No placement row, or `folderId: null` | `[{ name: "Home" }]`                                            |
| Placed in a folder                    | Folder names from root → leaf, e.g. `say-to-me / builder / tmp` |

- **Home** uses sentinel id `__root__` and links to `/organize` (not `/organize/__root__`).
- Each folder crumb links to `/organize/:folderId`.
- Separators: `/` between crumbs.

### Server payload

`organizePath` is attached to the session object in queue/broadcast payloads (`getOrganizePathForSession`). Shape:

```ts
type OrganizePathCrumb = { id: string; name: string };
```

Clients should treat missing `organizePath` as “at Home” and may fall back to `[ORGANIZE_ROOT_CRUMB]`.

### Relationship to line 1

Breadcrumbs describe **folder location**. Line 1 describes **session identity**. They are independent:

- A session in `tmp` can have alias “Page Organizer” and provider title “Page Organizer”.
- Breadcrumbs do not prefix or replace the hero title.

## Organize page vs session page

| Surface             | Label used                                         |
| ------------------- | -------------------------------------------------- |
| Organize tree row   | `resolveListDisplayName` (single label)            |
| Organize Rename     | Edits **alias** only (`PATCH` alias)               |
| Session page line 1 | Identity label; edit alias                         |
| Session page line 2 | Provider title; edit OpenCode title (`ses_*` only) |

## Examples

### Cursor session with alias

- `alias`: `Page Organizer`
- `opencodeTitle`: `Page Organizer` (from Cursor meta)
- `cwd`: `/Users/me/say-to-me`
- Placed in `say-to-me / workspace / tmp`

| Surface             | Value                         |
| ------------------- | ----------------------------- |
| List / organize row | `Page Organizer`              |
| Breadcrumbs         | `say-to-me / workspace / tmp` |
| Line 1              | `Page Organizer`              |
| Line 2              | `Page Organizer`              |

### OpenCode session with alias

- `alias`: `Morgan`
- `opencodeTitle`: null
- `cwd`: null
- At organize root

| Surface             | Value                                     |
| ------------------- | ----------------------------------------- |
| List / organize row | `Morgan`                                  |
| Breadcrumbs         | `Home`                                    |
| Line 1              | `Morgan`                                  |
| Line 2              | `ses_127b6d719ffe…` (session id fallback) |

### No alias, OpenCode titled

- `alias`: null
- `opencodeTitle`: `Fix checkout flow`
- `cwd`: `/tmp/say-to-me`

| Surface             | Value               |
| ------------------- | ------------------- |
| List / organize row | `Fix checkout flow` |
| Line 1              | `Fix checkout flow` |
| Line 2              | `Fix checkout flow` |

## Enrich tiers

Server enrichment is centralized in `server/session-enrich.ts`. Routes pick a tier; components never invent provider titles.

| Tier           | API / surface                          | Adds                                                                              |
| -------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| **0 — DB**     | Always                                 | alias, cwd, `organizePath`                                                        |
| **1 — Cached** | `listSessions`, notifications          | provider title via `getCachedProviderTitle` (OpenCode cache + Cursor/Claude meta) |
| **2 — Live**   | Session page SSE (`addOpenCodeStatus`) | refresh provider title on miss/stale                                              |

Client surfaces use `sessionListLabel(session)` from `src/session-label.ts` — a thin wrapper over `resolveListDisplayName`.

## Session mentions (references, not rename)

`say-to-me(id)` and message `sessions` arrays are **references**. They must not mutate `sessions.alias`.

- Rename alias: `PATCH /api/sessions/:id` with `{ alias }` (session page hero, Organize)
- `say-to-me(id, alias)` may appear in message text for display/history; the alias segment is **not** applied to the DB

## Tests

- `src/session-display.test.ts` — resolver chains
- `src/session-label.test.ts` — client label helpers
- `src/session-organize-path.test.ts` — breadcrumb paths including Home for root sessions

When changing naming rules, update these tests and this document together.
