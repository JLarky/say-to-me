# Agent Curl API Errors

Say To Me APIs are intentionally friendly to agents that call them with `curl`.
API errors should return JSON response bodies with a numeric `status` field and a
human-readable `error` field.

Example missing API route:

```bash
curl -sS -k 'https://say.local:1355/api/does-not-exist'
```

Expected raw output:

```json
{ "status": 404, "error": "Not found." }
```

This is expected even though `curl -sS` exits `0` for HTTP 404. The agent-facing
contract is that API callers can inspect the JSON body for `status` and `error`
without needing HTML parsing, response-header parsing, or a separate transport
error path.

## Why This Shape

- `curl -sS` is quiet and easy for agents to read.
- HTTP errors still produce compact JSON bodies.
- The body carries the application-level status in-band.
- Scripts that need a failing process exit can opt into curl failure flags.

## Curl Modes

Use `curl -sS` when the caller will inspect the JSON body:

```bash
curl -sS -k 'https://say.local:1355/api/does-not-exist'
```

Use `curl -sS -w` when the caller wants the body and an explicit HTTP status:

```bash
curl -sS -k -w '\nHTTP_STATUS:%{http_code}\n' \
  'https://say.local:1355/api/does-not-exist'
```

Expected raw output:

```text
{"status":404,"error":"Not found."}
HTTP_STATUS:404
```

Use `curl --fail-with-body -sS` when the caller wants a non-zero exit code and
the JSON body:

```bash
curl --fail-with-body -sS -k 'https://say.local:1355/api/does-not-exist'
```

## Server Requirements

- API routes should return JSON errors shaped as `{ "status": number, "error": string }`.
- Missing `/api/...` routes should return `{ "status": 404, "error": "Not found." }`.
- Error responses should not fall back to HTML error pages.
- A `curl -sS` caller must be able to detect application errors by reading the
  JSON `status` field.
