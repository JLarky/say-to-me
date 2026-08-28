# Adding a provider

Adding a provider is a cross-cutting change. A provider is not complete when
one delivery command works: session ids must be recognized consistently, the
session must be importable and referenceable, and every supported UI and
background path must either work or fail explicitly.

Use this checklist when adding a provider. Remove items that are deliberately
unsupported, and add a test or documented reason for each removed capability.

## Identity and session discovery

- [ ] Define the canonical Say To Me id shape and whether it preserves or
      canonicalizes provider casing.
- [ ] Add the id pattern to `src/external-cli/session-patterns.ts` when the id
      can appear in `say-to-me(id, title)` references or raw-id shorthand.
- [ ] Add backend detection, normalization, and importability to
      `src/session-id-patterns.ts` and `server/session-id.ts`.
- [ ] Update any backend classification used by organize trees, quick search,
      open-by-id, and session links.
- [ ] Add import/create/discovery behavior and tests. Verify that a created id
      is a real provider session id that can be resumed after a restart.

## Persistence and routing

- [ ] Add provider-specific session metadata only where it cannot be derived;
      update Drizzle schemas, runtime schemas, types, migrations, and fixtures
      together.
- [ ] Register the provider in the session router and ensure unsupported
      backends fail with a provider-specific, actionable error.
- [ ] Add target-session validation so direct messages, `sessions` references,
      and `say-to-me(...)` forwarding agree on which ids are referenceable.
- [ ] Update message reference lookup and session-card enrichment so mentions
      of the provider appear in the source session.

## Delivery and lifecycle

- [ ] Implement the provider delivery adapter/worker and its internal routes.
- [ ] Use durable delivery jobs with leases, retries, stable idempotency
      identity, and persisted errors; test crash/restart recovery, not only a
      successful send.
- [ ] Define busy/idle detection, completion notifications, and forwarding
      behavior. Verify that a forwarded message does not create duplicate source
      notifications.
- [ ] Implement stop/cancel semantics and confirm a stopped provider process
      cannot later publish a reply.
- [ ] Add provider-specific model, title, activity, and status adapters only
      when the provider supports them; otherwise return an explicit unsupported
      result.

## User-facing surfaces

- [ ] Add provider labels, icons, session titles, activity/status rendering,
      and delivery error text.
- [ ] Update session creation/import forms, quick search, open-by-id, session
      cards, message composer suggestions, and copy-reference actions.
- [ ] Update `scripts/say-to-me`, README examples, and relevant `docs/spec/`
      documents. User-visible references should use `say-to-me(id, title)`.
- [ ] Check notifications, voice playback, push text, and idle messages for
      provider-specific wording or unsupported assumptions.

## Validation and tests

- [ ] Add unit tests for every id pattern, normalization rule, and provider
      capability.
- [ ] Add API tests for create/import, direct delivery, forwarding,
      `say-to-me(...)` parsing, references, retries, failure reporting, and stop.
- [ ] Add UI tests for provider labels, cards, composer behavior, and errors.
- [ ] Run `vp run check`, focused provider tests, and `vp run test`.
- [ ] Perform a local end-to-end smoke test: create or import, send, receive a
      reply, forward to and from the provider, stop active work, restart the
      server, and retry a failed delivery.

## Final review

Before opening the PR, search for the provider prefix and inspect every hit:

```bash
rg -n "<provider-prefix>|provider|delivery|session" src server packages docs scripts
```

The search is a checklist aid, not proof of completeness. The provider should
also have one documented capability matrix stating what is supported,
unsupported, or intentionally deferred.
