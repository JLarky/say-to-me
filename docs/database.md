# Database Code

Use Drizzle for application database queries. Keep ArkType validation at runtime trust boundaries, such as raw SQL, aggregates, joins, parsed JSON, imports, exports, and external data.

## Queries

- Use `server/db/drizzle-schema.ts` as the source of truth for table columns.
- Use `drizzleDb` from `server/db/index.ts` for application queries.
- Prefer Drizzle query builders. If raw SQL is necessary, prefer Drizzle `sql` over direct SQLite adapter calls.
- Do not cast database results with `as any` or `as SomeType` to make types pass.

## Schema Changes

- Update `server/db/drizzle-schema.ts`.
- Update any relevant ArkType schema in `server/db/schemas.ts`.
- Run `pnpm db:generate` and commit the generated migration files.
- Run `pnpm db:compat -- /path/to/copied/queue.sqlite` against a copied database snapshot, not the live app database.
