# Spaces

## Purpose

Spaces organize repositories, Git worktrees, and agent sessions into focused
views. A repository and its workspaces/worktrees may be available in several
spaces. Live session imports remain exclusive.

The database is the source of truth. A one-time Drizzle migration seeds a real
top-level space named "Default" when the spaces table is empty. The migration
journal is the durable exactly-once mechanism; deleting every space later does
not recreate it. The dashboard prototype's localStorage fixtures are UI-only
and are not migrated.

Upgrade policy: a pre-0022 database that is already empty (for example because
the user deleted every space before upgrading) receives the Default space once
when 0022 applies. That is intentional — the empty table is treated as a
first-run database for seeding purposes. After 0022 has been recorded in the
migration journal, later deletions stay empty.

## Goals

- Persist spaces and their hierarchy in SQLite through Drizzle.
- Let one repository be attached to many spaces.
- Let the same main branch be visible in every space that has the repository.
- Let non-main worktrees be explicitly imported into any number of spaces.
- Let existing sessions be explicitly imported into one space.
- Keep a session's canonical working directory unchanged when it is imported.
- Discover a worktree's repository and branch from its path during import.
- Make session ownership conflicts explicit instead of silently moving data.

## Non-goals

- A generic directory entity or directory metadata model.
- Authentication, users, or multi-tenant permissions in the first slice.
- Real-time space events in the first slice.
- Copying session status, titles, provider data, or agent state into space
  tables.
- Automatically moving a session when a directory is associated with a
  different repository later.
- Re-seeding a default space after the user deletes every space once the
  seed migration has already run.

## Identity model

### Sessions

The existing `sessions` row remains canonical for a session. Its `cwd` is the
canonical execution directory and is the key used to find the worktree that a
session is running in.

Importing a session creates ownership metadata; it does not update `cwd`, the
provider session id, or any provider state. A session can be imported into at
most one space at a time.

### Repositories

A repository is a durable Git project identity. Repository identity should be
resolved from Git metadata, such as the canonical repository root and remote
identity where available, rather than being inferred from a display name.

A repository can be attached to many spaces. Attaching a repository does not
claim all of its non-main worktrees.

### Worktrees

A worktree is Git-specific metadata for a canonical path, including its current
repository, branch, and whether it is the main checkout. It is not a generic
directory entity. The path may later be removed from one repository and used by
another; changing that Git binding must not rewrite existing sessions with the
same `cwd`.

The main checkout is implicit for every space that has attached the repository.
Non-main worktrees must be explicitly imported into each space that should see
them. Importing the same worktree into another space adds another claim; it
does not move or remove the first claim.

### Spaces

A space contains presentation and hierarchy data: name, parent space, context,
archive state, and optional defaults. Repositories, worktrees, and sessions are
related through join and ownership tables rather than nested JSON.

## Database model

The exact column names should follow `server/db/drizzle-schema.ts`, but the
relationships are:

```text
spaces
  id, name, parent_id, archived, context,
  default_provider, default_model, access, created_at, updated_at

repositories
  id, identity, name, root_path, created_at, updated_at

worktrees
  id, path, repository_id, branch, is_main, discovered_at, updated_at

space_repositories
  space_id, repository_id, sort_order, created_at

space_worktrees
  worktree_id, space_id, imported_at

space_sessions
  session_id, space_id, imported_at
```

Recommended constraints and indexes:

- `spaces.parent_id` is indexed. Server writes must reject self-parenting and
  ancestor cycles.
- `repositories.identity` is unique when a stable identity is available.
  `root_path` should also be canonicalized and indexed.
- `worktrees.path` is unique because a path has one current Git binding at a
  time.
- `space_repositories(space_id, repository_id)` is unique.
- `space_worktrees(space_id, worktree_id)` is unique: each space can claim a
  worktree at most once, while the same worktree can be claimed by many spaces.
- `space_sessions(session_id)` is unique: a session can be imported into only
  one space.
- Foreign keys should use deliberate delete behavior. Removing a space should
  not delete repositories, worktrees, or sessions; it should remove ownership
  and attachment rows or archive the space in a transaction.

`space_worktrees` is the important distinction from a directory table: it
records which spaces have imported a Git worktree, while the worktree's path
and Git metadata remain shared and reusable.

## Visibility rules

For a given space:

1. Show repositories attached through `space_repositories`.
2. Show each attached repository's main worktree by default.
3. Show non-main worktrees only when their `space_worktrees` row belongs to the
   current space.
4. Show sessions already imported into the current space through
   `space_sessions`.
5. Show an unimported session as importable when its `cwd` matches a worktree
   visible to the current space and it has no `space_sessions` row.

Example:

```text
space1 attaches say-to-me
space2 attaches say-to-me

Both see: main
Neither sees: worktree1, until it is imported

space1 imports worktree1
space1 sees: main, worktree1
space2 sees: main

space2 imports worktree1
space1 and space2 see: main, worktree1

session1 has cwd = worktree1 path
space1 imports session1
session1 is no longer importable in space2
```

The repository attachment and worktree import are separate operations. A UI
may combine them into one import flow, but the server should still resolve the
Git context and apply the ownership changes atomically.

## Import behavior

### Importing a repository

1. Resolve the repository identity and canonical root from the requested path.
2. Upsert the repository record.
3. Insert the `space_repositories` row.
4. Return the repository and its default main checkout.

Attaching an already-attached repository is idempotent.

### Importing a worktree

1. Accept a path from an explicit user action.
2. Canonicalize the path.
3. Run Git discovery to determine repository, branch, root, and whether the
   path is the main checkout.
4. Upsert the shared worktree record.
5. Ensure the repository is attached to the target space.
6. For a non-main worktree, insert its `space_worktrees` ownership row.
7. If the target space already imported that worktree, treat the operation as
   idempotent. A claim in another space is not a conflict.

Main is visible through repository attachment and does not need an ownership
claim. Importing a non-main worktree should not change any session rows or
claims in other spaces.

### Importing a session

1. Resolve the session by its existing id.
2. Read and canonicalize its existing `cwd`.
3. Discover the repository and worktree for that path.
4. Confirm that the worktree is visible to the target space. If it is a
   non-main worktree, the flow may offer to import it first.
5. Insert `space_sessions` in a transaction.
6. If another space already owns the session, return a conflict and leave the
   current owner unchanged.

Importing a session is not a move of its directory or provider session. A
future explicit move operation must be separate and visible to the user.

## API direction

Use a dedicated Effect API group and a server service, following the existing
`session-folders` and `sessions` patterns.

Candidate endpoints:

- `GET /api/spaces` — list active spaces and counts.
- `GET /api/spaces/:spaceId` — return one space with visible repositories,
  worktrees, sessions, and importable sessions.
- `POST /api/spaces` — create a space.
- `PATCH /api/spaces/:spaceId` — edit name, context, defaults, or parent.
- `POST /api/spaces/:spaceId/repositories/import` — attach a repository.
- `POST /api/spaces/:spaceId/worktrees/import` — discover and claim a
  non-main worktree.
- `POST /api/spaces/:spaceId/worktrees/claim` — claim an already-discovered
  worktree in this space without changing its Git checkout.
- `DELETE /api/spaces/:spaceId/worktrees/:worktreeId` — release this space's
  worktree claim without deleting files or the shared worktree record.
- `POST /api/spaces/:spaceId/sessions/import` — claim an existing session.
- `POST /api/spaces/:spaceId/archive` — archive a space and release its
  ownership rows without deleting shared resources.

The detail response should be a purpose-built view model. It may include
session fields from the existing session payload, but those fields must remain
owned by the `sessions` table and provider enrichment code.

Use `Effect.Schema` for HTTP path, payload, success, and error contracts. Use
ArkType DB row schemas at the database boundary, including validation of
joined rows and Git-discovery results. Return conflicts as clear `409` errors;
invalid paths and malformed payloads are `400`; missing resources are `404`.

## Client direction

- Add a spaces data hook that loads the route's space from the API.
- Keep `/dashboard/:spaceId` as the selected-space URL and navigation source.
- Replace prototype state mutation and localStorage persistence with API calls.
- After mutations, use the returned view model or refetch the affected space;
  do not optimistically invent repository or worktree relationships in the
  browser.
- Render an empty state when the database has no spaces. Server-side fixture
  seeding should be an explicit development choice, not an implicit browser
  migration.

## Transactions and concurrency

The following operations must be transactional:

- creating or deleting a space subtree;
- importing a repository and attaching it to a space;
- discovering a worktree and adding its space claim;
- importing a session and claiming its ownership;
- moving or releasing ownership.

Database uniqueness constraints prevent duplicate claims within one space and
prevent two spaces from importing the same session. The API should translate
those constraint failures into deterministic conflict responses.

## Migration and rollout

There is no localStorage migration. The rollout is:

1. Add the normalized tables and generated Drizzle migration.
2. Add server queries and read-only space endpoints.
3. Switch the dashboard to database reads and render the empty state.
4. Add repository, worktree, and session import mutations.
5. Replace remaining prototype actions with API-backed mutations.
6. Add Git discovery and conflict handling to import flows.
7. Remove seeded client state and unused prototype persistence helpers.

Run the database compatibility check against a copied SQLite database snapshot,
not the live application database, before shipping the schema migration.

## Testing

The first API test matrix should cover:

- two spaces attaching the same repository;
- both spaces seeing main by default;
- a non-main worktree claimed by space1 and hidden from space2 until space2
  imports it too;
- the same non-main worktree being claimed by both spaces and visible in both;
- an unimported session being importable from every space where its worktree is
  visible;
- an imported session disappearing from all other importable lists;
- duplicate worktree imports in one space being idempotent;
- duplicate session imports and session imports into another space returning
  conflicts;
- a path being rebound to another repository without changing old sessions'
  `cwd` or space ownership;
- parent-cycle rejection;
- transaction rollback when Git discovery or ownership insertion fails.

Client tests should verify that route navigation, empty states, importable
session lists, and conflict responses reflect the server view model.

## Deferred decisions

- Whether a repository's stable identity is based primarily on remote URL,
  canonical root, or both when a repository has no remote.
- Whether worktree claims can later be released explicitly.
- Whether a session can be shared through a separate view or tag without
  changing its single-space ownership.
- Authentication, memberships, and live updates for multi-user deployments.
