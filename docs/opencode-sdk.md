# Consuming the OpenCode SDK

We talk to OpenCode through `@opencode-ai/sdk/v2/client`. **Never cast SDK responses (`as any` / `as SomeType`).** The client's `.data` is already fully typed from OpenCode's generated OpenAPI types — read fields directly.

- The package ships **two** type trees. The **v2** client we use (`dist/v2/gen`) is the rich one: `Session` has `workspaceID?`, `path?`, `slug`, `agent`, …; `Project` has `name?`, `icon`, `commands.start`, `sandboxes`. The v1 tree (`dist/gen`) is trimmed and omits these — when checking what a call returns, inspect `dist/v2/gen`, not `dist/gen`.
- Import the SDK's own types instead of re-declaring shapes: `import type { Session, Project } from "@opencode-ai/sdk/v2/client"` (the v2 entry re-exports its gen types).
- At the boundary where SDK shapes feed our own storage/API types, pin a SDK-derived type with `satisfies` so an upstream rename becomes a compile error rather than a silent `null`:

```ts
import type { Session as OcSession, Project as OcProject } from "@opencode-ai/sdk/v2/client";

type OpenCodeContext = {
  projectId: OcSession["projectID"];
  workspaceId: NonNullable<OcSession["workspaceID"]> | null;
  // …
  projectName: NonNullable<OcProject["name"]> | null;
};

const ctx = {
  projectId: session.projectID,
  workspaceId: session.workspaceID ?? null,
  projectName: project.name ?? null,
} satisfies OpenCodeContext;
```

Do not add a second generated client for OpenCode unless the official SDK cannot represent a required API.

## Effect route pattern

Migrated OpenCode routes should follow the same small Effect shape:

- Put external dependencies behind route-local Effect services. SDK calls, filesystem checks, queue/session enrichment, clocks, and other process-boundary work should live in service methods with a live layer. Keep validation and route workflow composition in the Effect program.
- Export the injectable workflow separately from the live wrapper when tests need it. For example, expose a `*Program` / `*Effect` that requires the service, then keep the existing public helper live-wired with `Effect.provide(...)` for current callers.
- Test route behavior with direct Effect workflow tests and fake layers. Cover success, validation short-circuiting, upstream failures, and call ordering there instead of standing up HTTP plus fake OpenCode for every branch.
- Keep mounted or `fetch` tests for adapter and wiring behavior only. Use them when the assertion needs Express/HttpApi mounting, request decoding, public HTTP status/body shape, SDK URL construction, or another real integration boundary.
- Use the shared typed route error helper for public JSON failures. Route errors should carry `_tag`, `error`, and `status`; handlers should map those through the shared public error response helper instead of hand-rolling `unsafeJson({ error }, { status })` in every endpoint.
- Do not create broad test frameworks. Share only proven, repeated fake-layer helpers after there are multiple callers; route-specific fake behavior and assertions should stay in the route test file.

Keep each migration PR narrow: one route, one dependency seam, or one helper at a time unless a larger change is required to preserve behavior.

## Session labels

Visible labels should prefer short, human-readable names:

- project: `project.name`, then worktree basename, then directory basename
- workspace: directory basename, then branch, then `workspace-<shortId>`

Show a workspace segment only when `workspaceID` exists or `directory != worktree`. A normal repo session on a branch should show only the project label; keep the branch in the tooltip. The raw project id should stay tooltip-only unless no other label exists.

The git branch comes from `client.vcs.get({ directory })` and is stored as `opencode_branch`. It is captured once with the rest of the context and is not re-polled.

## Creating sessions and worktrees from a group page

- Workspace page: `Create session in this workspace` posts the workspace's cached `opencodeDirectory` to `POST /api/opencode-sessions`.
- Project page: `Create session in <project>` posts the best project directory to `POST /api/opencode-sessions`; `Create worktree` posts it to `POST /api/opencode-workspaces`.

For project context, prefer `opencodeWorktree`, then any session `opencodeDirectory` in the project. `createOpenCodeWorktreeSession` reuses the first listed worktree with no Say To Me session before creating one with `client.worktree.create({ directory, worktreeCreateInput: {} })`.

### Re-importing context (dev only)

Context is captured once at import and lazily backfilled only when a row has none. To force a fresh capture for one session, POST to:

```
POST /api/dev/sessions/:sessionId/reimport-context
```

The route is gated behind `import.meta.env?.DEV` and calls `reimportOpenCodeContext`, which overwrites the stored context without the lazy-backfill cooldown.
