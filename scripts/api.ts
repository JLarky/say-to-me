#!/usr/bin/env node
import { EOL } from "node:os";
import {
  API_CLI_HELP,
  buildRequestHeaders,
  executeRawApiRequest,
  fetchOpenApiDocument,
  findOpenApiOperationHelp,
  formatApiRecoveryHint,
  formatOpenApiCatalog,
  formatOpenApiOperationHelp,
  listOpenApiOperations,
  parseApiCliArgs,
  readBodySource,
  resolveBaseUrl,
  resolveCliRequest,
  writeText,
} from "../server/cli/api-request.ts";

function formatCliFetchError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const causeMessage =
    cause instanceof Error && cause.cause instanceof Error
      ? cause.cause.message
      : cause instanceof Error && typeof cause.cause === "string"
        ? cause.cause
        : "";
  const tlsHint =
    /self-signed|certificate/i.test(`${message}\n${causeMessage}`) ||
    (message === "fetch failed" && /certificate/i.test(causeMessage));
  if (!tlsHint) return `${message}\n`;
  return (
    `${message}${causeMessage ? ` (${causeMessage})` : ""}\n` +
    `Tip: portless HTTPS needs ~/.portless/ca.pem, or use --server http://127.0.0.1:<app-port>\n`
  );
}

const parsed = parseApiCliArgs(process.argv.slice(2));

if (parsed.kind === "help") {
  await writeText(process.stdout, API_CLI_HELP);
  process.exitCode = 0;
} else if (parsed.kind === "error") {
  await writeText(process.stderr, `${parsed.message}\nTry: say-to-me api --help\n`);
  process.exitCode = 2;
} else if (parsed.kind === "list") {
  const baseUrl = resolveBaseUrl(parsed.server);
  try {
    const spec = await fetchOpenApiDocument({ baseUrl });
    const catalog = formatOpenApiCatalog(listOpenApiOperations(spec));
    await writeText(process.stdout, catalog);
    process.exitCode = 0;
  } catch (error) {
    await writeText(process.stderr, formatCliFetchError(error));
    process.exitCode = 1;
  }
} else if (parsed.kind === "operation-help") {
  const baseUrl = resolveBaseUrl(parsed.server);
  try {
    const spec = await fetchOpenApiDocument({ baseUrl });
    const help = findOpenApiOperationHelp(spec, parsed.operationId);
    if (!help) {
      await writeText(
        process.stderr,
        `Operation not found: ${parsed.operationId}\n` +
          `List operations with: say-to-me api list\n`,
      );
      process.exitCode = 1;
    } else {
      await writeText(process.stdout, formatOpenApiOperationHelp(help));
      process.exitCode = 0;
    }
  } catch (error) {
    await writeText(process.stderr, formatCliFetchError(error));
    process.exitCode = 1;
  }
} else {
  const baseUrl = resolveBaseUrl(parsed.server);
  try {
    const resolved = await resolveCliRequest({
      baseUrl,
      target: parsed.target,
      params: parsed.params,
    });
    const body = await readBodySource(parsed.body);
    const headers = buildRequestHeaders(parsed.headers, body);
    const result = await executeRawApiRequest({
      baseUrl,
      method: resolved.method,
      path: resolved.path,
      headers,
      body,
    });
    const output = result.body;
    if (output) await writeText(process.stdout, output + (output.endsWith(EOL) ? "" : EOL));
    if (!result.ok) {
      // Status + recovery on stderr; body stays on stdout for jq.
      await writeText(process.stderr, formatApiRecoveryHint(result.status, parsed.target));
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    await writeText(process.stderr, formatCliFetchError(error));
    process.exitCode = 1;
  }
}
