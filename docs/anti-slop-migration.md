# Anti-slop migration decisions

Anti-slop rules currently run as warnings. A warning identifies code that deserves
review; it does not prove the code is wrong. Preserve runtime behavior and type
evidence even when that means leaving a warning for a later rule improvement or a
focused suppression.

## Decision order

For each finding:

1. Decide whether the flagged construct is actually unsafe in its context.
2. If it is unsafe, repair the owning contract or validate the value at the trust
   boundary.
3. If the construct is legitimate, keep it and improve the rule or add the
   narrowest documented suppression once warnings become errors.
4. Do not replace a correct construct with a less accurate spelling merely because
   the rule does not recognize it.

## Accepted patterns

| Situation                                                            | Preferred resolution                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Untrusted JSON, SDK, database, or process output                     | Parse once with ArkType at the trust boundary and return a named validated type. A TypeScript generic or assertion does not validate runtime data.                                                                                             |
| A known object literal is widened by an annotation                   | Keep inference and use `satisfies` to check the owner contract.                                                                                                                                                                                |
| A function's explicit object return type is useful API documentation | Define a named owner type and retain the return annotation. Do not delete the contract just to preserve inference.                                                                                                                             |
| A caught or rejected value                                           | Keep it `unknown`. Narrow only before inspecting properties, using a schema or a focused type guard. A callback that only rethrows the value needs no invented generic type.                                                                   |
| A real union with distinct runtime representations                   | Use the union's correct runtime discriminator. If the rule rejects the idiomatic discriminator, improve or suppress the rule rather than substituting a weaker check.                                                                          |
| Test data passed directly to `JSON.stringify`                        | Use a named `JsonValue`/fixture contract when JSON compatibility matters, or retain `unknown` with a focused rule exception. Do not change the parameter to an unconstrained generic solely to silence lint.                                   |
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

Activity/title fixtures changed `(value: unknown)` to unconstrained `<T>(value: T)`
helpers before calling `JSON.stringify`.

Right resolution: use a project `JsonValue` fixture type if call-site JSON safety
is valuable; otherwise retain `unknown` and suppress the rule for a transparent
serialization sink.

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
- Initial cleanup: PR #11. Rejected patterns above were removed before review.
- Flaky-test deletion: PR #13. Its removed coverage must be reviewed and restored
  separately; test deletion is not an anti-slop fix.
