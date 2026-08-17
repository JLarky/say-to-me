<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Local vs CI validation (task cache)

The Vite+ block above is rewritten by `vp install`. Keep project-specific validation guidance **below** `<!--VITE PLUS END-->` so it survives that rewrite.

CI always runs the full suite with no task-cache replay:

```bash
vp check && vp test
```

Locally, prefer the cached script path (enabled via `run.cache.scripts` in `vite.config.ts`) instead of the bare checklist commands:

```bash
vp run check
vp run test
```

`package.json` `test` runs leaf packages via `vp run --filter "./packages/*" test` (each package owns a cached `test` task), then `shared-modules` and `isolated-env`. Unchanged packages replay from cache — like turbo `run --filter=*`.

Day-to-day expectations:

- Frontend-only edit → leaf package tasks stay cache hits; only `shared-modules` re-executes.
- Single leaf-package edit → that package's `test` task misses; app projects also miss if they import that package (correct).
- Unchanged tree → `vp run test` can finish in tens of milliseconds (full replay).
- Agents must call `vp run test` / `vp run check`, not bare `vp test` / `vp check`, or they bypass the cache.
- Optional tighter loops while iterating: `vp test related <file> --project shared-modules` or `vp run check -- packages/<name>` (path args are separate cache keys). Ship gate is still full `vp run check && vp run test`.
- New leaf packages: add `packages/<name>/vite.config.ts` using `packageTestConfig` from `packages/package-test-task.ts`.

Docs: https://viteplus.dev/guide/cache and https://viteplus.dev/guide/run (`vp run --filter`, compound `&&` caching).

## Dev Server & HMR

The default dev server runs via Astro/Elysia. Start it with the package script (not a bare `vp dev`):

```bash
vp run dev
```

That script already runs Astro in `--background` mode so it behaves like the long-running shared dev servers agents normally use.

Useful follow-up commands:

```bash
vp exec astro dev logs --follow
vp exec astro dev status
vp exec astro dev stop
```

## Shared App Port

If you need to find the already-running shared app instance on this machine, use `portless list`.

Example output:

```bash
portless list
```

Look for the `say.local` route, which maps the shared HTTPS hostname to a local forwarded port, for example:

```text
https://say.local:1355  ->  localhost:4121
```

When validating locally from the VM, prefer the forwarded local port (for example `http://127.0.0.1:4121`) instead of starting extra temporary dev servers unless you specifically need an isolated build.

## Browser Automation

Use `agent-browser` for browser automation tasks. Repository: https://github.com/vercel-labs/agent-browser

## GitHub PRs

Create draft PRs by default. Only create a ready-for-review PR when the user explicitly asks for it.

## Anti-slop migration

Read [docs/anti-slop-migration.md](docs/anti-slop-migration.md) before fixing an
anti-slop warning. A warning is a review prompt, not a mandate to rewrite correct
code. Do not change runtime semantics, remove validation, weaken a public type
contract, launder `unknown` through a generic or assertion, or delete tests merely
to silence a rule. Leave the warning in place when the rule does not fit the code.

## Fonts

**Never use network fonts.** Do not add `@import` for Google Fonts, Adobe Fonts, or any other external font service. Do not add `<link rel="stylesheet">` tags pointing to font CDNs. The font stack in `src/styles.css` must use only system fonts (`ui-sans-serif`, `system-ui`, `-apple-system`, etc.). This rule exists because network fonts introduce an external dependency, slow down load on poor connections, and have crept in accidentally before.

## Database Code

Use Drizzle for application database queries and keep ArkType validation at runtime trust boundaries. See [docs/database.md](docs/database.md) before adding or changing database code.

## Consuming the OpenCode SDK

We talk to OpenCode through `@opencode-ai/sdk/v2/client`. **Never cast SDK responses (`as any` / `as SomeType`)** — the client's `.data` is already fully typed, and the SDK→storage boundary is pinned with `satisfies`. See [docs/opencode-sdk.md](docs/opencode-sdk.md).
That doc also captures the canonical Effect route and test pattern for migrated OpenCode routes.

## Local Effect Source

Per [Effect Solutions project setup](https://www.effect.solutions/project-setup), keep a local Effect source checkout for agent reference.

The Effect v4 repository is cloned to `~/.local/share/effect-solutions/effect` for reference.
Use this to explore APIs, find usage examples, and understand implementation
details when the documentation isn't enough.

Setup (once per machine):

```bash
git clone --depth 1 https://github.com/Effect-TS/effect-smol.git ~/.local/share/effect-solutions/effect
```

To update later: `git -C ~/.local/share/effect-solutions/effect pull --depth 1`

## Cursor Cloud specific instructions

- The `vp` CLI is the toolchain for install/check/test/build. It lives at `~/.vite-plus/bin/vp` and manages its own Node (24) + package manager; the system Node/package manager are older and won't satisfy `engine-strict`, so don't fall back to plain `pnpm`/`npm` outside of `vp`/`nub`. Non-interactive shells do not source `~/.vite-plus/env`, so either run `export PATH="$HOME/.vite-plus/bin:$PATH"` first or call the binary by absolute path. The project uses pnpm (`packageManager` in `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`). The lockfile is generated by [nub](https://github.com/nubjs/nub) (`nub install`), which reads whatever lockfile format is present (`pnpm-lock.yaml` here); `vp install` delegates to its bundled pnpm which produces an equivalent lock. Use `nub install` locally for faster installs; `vp install` remains compatible for non-nub users.
- The startup update script already runs `vp install`; no extra dependency setup is needed. Standard local validation is `vp run check`, `vp run test`, and `vp build`. CI uses bare `vp check` and `vp test` (no task-cache replay). Prefer `vp run *` locally so Vitest projects cache independently; use bare commands only to force a full re-run. Use `vp run dev` for local dev (not bare `vp dev`), or run it through `portless` for stable URLs.
- No external database is required: SQLite is embedded via `better-sqlite3` and auto-created/migrated at `.local/queue.sqlite` on first request (override with `SAY_TO_ME_DB`).
- Core queue quick check (no browser needed): `POST /say` to enqueue, `GET /api/queue` to read back. The web UI's TTS playback needs a real browser with `speechSynthesis`.
- The OpenCode-backed session/Jarvis features expect an OpenCode server at `http://localhost:4096` (`SAY_TO_ME_OPENCODE_URL`). It is optional — those features fail soft / report `unavailable` when no server is running.
