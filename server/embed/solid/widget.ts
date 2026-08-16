import * as esbuild from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";
import { fileURLToPath } from "node:url";
import { EMBED_WIDGET_PATH, EMBED_WIDGET_SOURCE, EMBED_WIDGET_TAG } from "./widget-shared.ts";

/**
 * Generic Solid widget.
 *
 * Host usage:
 *   <script src="http://localhost:5411/embed/widget.js"></script>
 *   <say-to-me-widget session-id="ses_…"></say-to-me-widget>
 */
export const EMBED_WIDGET_JS_PATH = EMBED_WIDGET_PATH;

export { EMBED_WIDGET_PATH, EMBED_WIDGET_SOURCE, EMBED_WIDGET_TAG };

const browserEntryPath = fileURLToPath(new URL("./widget-browser-entry.ts", import.meta.url));

let cachedClassicScript: string | null = null;
let buildInFlight: Promise<string> | null = null;

type ClassicBuilder = () => Promise<{ readonly text: string; readonly buildMs: number }>;

async function defaultClassicBuilder(): Promise<{
  readonly text: string;
  readonly buildMs: number;
}> {
  const started = performance.now();
  const result = await esbuild.build({
    entryPoints: [browserEntryPath],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    logLevel: "silent",
    plugins: [solidPlugin()],
  });
  const file = result.outputFiles[0];
  if (!file) throw new Error("esbuild produced no output for widget classic bundle");
  return { text: file.text, buildMs: performance.now() - started };
}

let classicBuilder: ClassicBuilder = defaultClassicBuilder;

export function invalidateEmbedWidgetScriptCache(): void {
  cachedClassicScript = null;
  buildInFlight = null;
}

/** Test-only: swap the classic builder (restore with `null`). */
export function setEmbedWidgetClassicBuilderForTests(next: ClassicBuilder | null): void {
  classicBuilder = next ?? defaultClassicBuilder;
  invalidateEmbedWidgetScriptCache();
}

/** Bundle the Solid registration entry for classic <script src> hosts. */
export async function buildEmbedWidgetScript(): Promise<{
  readonly text: string;
  readonly buildMs: number;
}> {
  return classicBuilder();
}

export async function getEmbedWidgetScript(): Promise<string> {
  if (cachedClassicScript) return cachedClassicScript;
  buildInFlight ??= classicBuilder()
    .then(({ text }) => {
      cachedClassicScript = text;
      buildInFlight = null;
      return text;
    })
    .catch((error: unknown) => {
      buildInFlight = null;
      throw error;
    });
  return buildInFlight;
}

type EmbedWidgetResponseOptions = {
  readonly development?: boolean;
};

export async function createEmbedWidgetResponse(
  options: EmbedWidgetResponseOptions = {},
): Promise<Response> {
  const development = options.development ?? import.meta.env?.DEV === true;
  const body = development ? (await buildEmbedWidgetScript()).text : await getEmbedWidgetScript();
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function dispatchEmbedWidgetRequest(
  request: Request,
  options?: EmbedWidgetResponseOptions,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const { pathname } = new URL(request.url);
  if (pathname !== EMBED_WIDGET_PATH) return null;
  const response = await createEmbedWidgetResponse(options);
  if (request.method === "HEAD") {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}
