# Anti-slop migration decisions

Anti-slop rules currently run as warnings. A warning identifies code that deserves
review; it does not prove the code is wrong. Preserve runtime behavior and type
evidence even when that means leaving a warning for a later rule improvement or a
focused suppression.

## Decision order

For each finding:

1. Decide whether the flagged construct is actually unsafe in its context.
2. If it is unsafe and the repair is small and self-contained, fix the owning
   contract or validate the value at the trust boundary now.
3. If it is unsafe but the real repair needs larger contract work (a new owner
   type, a schema migration, an API change touching other callers), leave the
   warning in place and track the larger repair separately. Do not paper over
   it with a local change that still discards the same type evidence.
4. If the construct is legitimate, keep it and improve the rule, or add the
   narrowest documented suppression once warnings become errors.
5. Do not replace a correct construct with a less accurate spelling merely because
   the rule does not recognize it.

`oxlint-disable-next-line` is not allowed while these rules are at warning
severity. A warning does not fail the build, so a disable comment only hides the
review prompt instead of resolving it (step 2) or holding it honestly (step 3).
Suppressions are for after a rule moves to error, and even then only with the
narrowest scope and a documented reason.

## Accepted patterns

| Situation                                                            | Preferred resolution                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Untrusted JSON, raw-SQL/aggregate database rows, or process output   | Parse once with ArkType at the trust boundary and return a named validated type. A TypeScript generic or assertion does not validate runtime data. See docs/database.md.                                                                       |
| OpenCode SDK responses (`@opencode-ai/sdk/v2/client`)                | Already typed by the generated v2 client; read `.data` fields directly. Do not re-validate with ArkType or cast. ArkType belongs at untyped I/O, not on already-typed generated SDK data. See docs/opencode-sdk.md.                            |
| A known object literal is widened by an annotation                   | Keep inference and use `satisfies` to check the owner contract.                                                                                                                                                                                |
| A function's explicit object return type is useful API documentation | Define a named owner type and retain the return annotation. Do not delete the contract just to preserve inference.                                                                                                                             |
| A caught or rejected value                                           | Keep it `unknown`. Narrow only before inspecting properties, using a schema or a focused type guard. A callback that only rethrows the value needs no invented generic type.                                                                   |
| A real union with distinct runtime representations                   | Use the union's correct runtime discriminator. If the rule rejects the idiomatic discriminator, improve or suppress the rule rather than substituting a weaker check.                                                                          |
| Test data passed directly to `JSON.stringify` with no read-back      | Retain the `unknown` parameter; a transparent serialization sink does not need to recover the value's shape. Do not change the parameter to an unconstrained generic solely to silence lint.                                                   |
| An assertion over a controlled test fixture                          | Prefer a typed fixture or schema. A `SAFETY:` comment is acceptable only when it states a concrete invariant that the same test or module controls; a comment is not runtime validation.                                                       |
| A callback receives several event-specific payloads                  | Express the relationship in the owning callback type, ideally with an event-to-detail mapping. Do not cast the broad callback value to a hand-written union in the consumer.                                                                   |
| Effect layers do not compose without `any`/`never`                   | Make the helper generic over the API and its requirements, or keep the warning until the owner types can be repaired. A comment does not make `as never` sound.                                                                                |
| A test is flaky                                                      | Repair isolation, deterministic scheduling, polling predicates, or ownership of shared state. Do not delete coverage to make CI green. If temporary quarantine is unavoidable, keep a tracked restoration issue and the smallest skipped test. |

## Rejected fixes from the initial batch

These patterns were removed from the cleanup PR and should not be reintroduced.

### Callable values

`VoiceNoteSessionCard` and `VoiceSessionWaitingBadge` changed
`typeof value === "function"` to `value instanceof Function`. The replacement has
different cross-realm behavior and exists only to evade `no-runtime-typeof`.

Right resolution: keep the correct discriminator. Longer term, either teach the
rule to allow discriminating a declared callable union or split the API into
unambiguous value and accessor properties.

### SQLite PRAGMA results

`notification-history.ts` supplied `{ name: string }` as the result generic for a
raw SQLite statement and removed its runtime guard. The generic is compile-time
only and cannot establish the shape of database output.

Right resolution: validate PRAGMA rows at the raw-query boundary with ArkType, or
keep the existing guard. Return a named validated row type to the migration code.

### Promise rejection values

`widget.ts` changed an `unknown` rejection parameter to a generic `<E>`. That does
not discover or constrain the thrown value.

Right resolution: keep `unknown`. This handler only resets state and rethrows, so
it does not need to narrow the value. The rule should exempt rejection handlers
that do not inspect the error.

### Test fixture serializers

`server/claude/activity-hub.test.ts`, `server/claude/activity.test.ts`,
`server/claude/title.test.ts`, `server/codex/activity-hub.test.ts`,
`server/codex/activity.test.ts`, `server/codex/title.test.ts`,
`server/cursor/activity-hub.test.ts`, `server/cursor/activity.test.ts`,
`server/grok/activity.test.ts`, and `server/markdown/extra-markdown-html.test.ts`
changed a `(value: unknown)` JSON-line helper to an unconstrained `<T>(value: T)`
generic before calling `JSON.stringify`.

Right resolution: keep the parameter `unknown`. Each helper only serializes a
value for a test fixture line; it never reads the value back, so there is no
shape to recover. Leave the warning if the rule does not already exempt
transparent serialization sinks.

### Node server addresses

REST worker tests replaced the standard `typeof address === "string"` union check
with own-property probing.

Right resolution: keep the Node API's documented discriminator. A shared
`requireTcpAddress` helper may improve repetition, but it should still implement
the documented `null`/`string`/`AddressInfo` check directly.

### Request bodies in tests

`session-creation-api.test.ts` replaced a string guard with `body as string` before
`JSON.parse`, then validated the parsed value. Validation after an unchecked cast
does not protect the operation that requires the string.

Right resolution: first establish that `RequestInit.body` is a string, then parse
and validate the JSON with ArkType. If the runtime discriminator is flagged, keep
the warning or suppress that exact boundary check.

### Session runtime log details

`sessionRuntime.test.ts` cast a broad `Record<string, unknown>` callback payload to
a hand-maintained union that the callback contract did not guarantee.

Right resolution: introduce an event-to-detail mapping in the production logging
contract so each event carries its real detail type. Until then, keep the test's
broad capture type because the test does not inspect the details.

### Exported return contracts

Removing the explicit return type from `resolveJarvisWorkspacePath` and from test
store helpers hides the finding instead of defining ownership.

Right resolution: give the object shape a descriptive named type and retain the
explicit return annotation where it is part of the readable contract.

### Existing assertions

Adding a comment to `as never`, `as PushError`, or another assertion is not a fix
when the claimed invariant is not actually enforced.

Right resolution: make the Effect helper generic over its layer requirements and
parse caught push errors before reading their fields. Leave the warning until that
work is ready rather than overstating safety in a comment.

## Review record

- Setup: PR #10, merged with rules at warning severity.
- Initial cleanup: PR #11 (open). Rejected patterns above were removed before
  review; the remaining diff has not merged.
- Rebase attempt: PR #67 (open), rebasing PR #11 onto current main. Rejected as
  too large for one review pass; do not land it as-is.
- Flaky-test deletion: PR #13. Its removed coverage must be reviewed and restored
  separately; test deletion is not an anti-slop fix. Restoration is tracked in
  issue #15 / PR #14.
- This doc and its `AGENTS.md` link landed standalone in PR #65. Once #65 merges,
  drop the same two files from #11 and #67 so they do not reintroduce a
  conflicting copy.
