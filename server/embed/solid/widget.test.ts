import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  EMBED_WIDGET_PATH,
  EMBED_WIDGET_SOURCE,
  EMBED_WIDGET_TAG,
  buildEmbedWidgetScript,
  dispatchEmbedWidgetRequest,
  getEmbedWidgetScript,
  invalidateEmbedWidgetScriptCache,
  setEmbedWidgetClassicBuilderForTests,
} from "./widget.ts";
import {
  EMBED_WIDGET_PARK_SESSION_EVENT,
  WIDGET_REQUIRED_ATTRIBUTES,
  requireWidgetSessionId,
} from "./widget-shared.ts";
import { WIDGET_STYLE_MARKER } from "./widget-styles.ts";

describe("embed widget route", () => {
  afterEach(() => {
    setEmbedWidgetClassicBuilderForTests(null);
    invalidateEmbedWidgetScriptCache();
    vi.restoreAllMocks();
  });

  it("serves a self-contained classic widget IIFE", async () => {
    const response = await dispatchEmbedWidgetRequest(
      new Request(`http://say.local${EMBED_WIDGET_PATH}`),
    );
    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(200);
    expect(response!.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response!.headers.get("cache-control")).toBe("no-store");
    const body = await response!.text();
    expect(body).toBe(await getEmbedWidgetScript());
    expect(body).toContain(EMBED_WIDGET_TAG);
    expect(body).toContain(EMBED_WIDGET_SOURCE);
    expect(body).toContain(EMBED_WIDGET_PARK_SESSION_EVENT);
    expect(body).toContain(WIDGET_STYLE_MARKER);
    expect(body).toContain("stm-id-btn");
    expect(body).toContain("Copy Say To Me session mention");
    expect(body).toContain("stm-park-btn");
    expect(body).toContain("Park session");
    expect(body).not.toContain("@say-to-me/runtime-validation");
    expect(body).not.toContain("arktype");
  });

  it("supports HEAD with the same headers and empty body", async () => {
    const response = await dispatchEmbedWidgetRequest(
      new Request(`http://say.local${EMBED_WIDGET_PATH}`, { method: "HEAD" }),
    );
    expect(response?.status).toBe(200);
    expect(await response!.text()).toBe("");
  });

  it("ignores unrelated methods and paths", async () => {
    expect(
      await dispatchEmbedWidgetRequest(
        new Request(`http://say.local${EMBED_WIDGET_PATH}`, { method: "POST" }),
      ),
    ).toBeNull();
    expect(
      await dispatchEmbedWidgetRequest(new Request("http://say.local/embed/widget")),
    ).toBeNull();
  });

  it("rebuilds classic responses in development", async () => {
    let builds = 0;
    setEmbedWidgetClassicBuilderForTests(async () => {
      builds += 1;
      return { text: `/* widget ${builds} */`, buildMs: 1 };
    });

    const request = new Request(`http://say.local${EMBED_WIDGET_PATH}`);
    const first = await dispatchEmbedWidgetRequest(request, { development: true });
    const second = await dispatchEmbedWidgetRequest(request, { development: true });

    expect(await first!.text()).toBe("/* widget 1 */");
    expect(await second!.text()).toBe("/* widget 2 */");
    expect(builds).toBe(2);
  });

  it("caches and deduplicates concurrent classic responses in production", async () => {
    let builds = 0;
    let finishBuild: ((value: { text: string; buildMs: number }) => void) | undefined;
    setEmbedWidgetClassicBuilderForTests(
      () =>
        new Promise((resolve) => {
          builds += 1;
          finishBuild = resolve;
        }),
    );

    const request = new Request(`http://say.local${EMBED_WIDGET_PATH}`);
    const first = dispatchEmbedWidgetRequest(request, { development: false });
    const second = dispatchEmbedWidgetRequest(request, { development: false });
    await vi.waitFor(() => expect(builds).toBe(1));
    finishBuild!({ text: "/* production widget */", buildMs: 1 });

    expect(await (await first)!.text()).toBe("/* production widget */");
    expect(await (await second)!.text()).toBe("/* production widget */");
    expect(await (await dispatchEmbedWidgetRequest(request, { development: false }))!.text()).toBe(
      "/* production widget */",
    );
    expect(builds).toBe(1);
  });

  it("reports classic bundle size and build time", async () => {
    const solid = await buildEmbedWidgetScript();
    const solidBytes = Buffer.byteLength(solid.text, "utf8");
    expect(solidBytes).toBeGreaterThan(1_000);
    expect(solidBytes).toBeLessThan(250_000);
    expect(solid.buildMs).toBeGreaterThan(0);
    expect(solid.text).toContain(EMBED_WIDGET_TAG);
    expect(solid.text).toContain("say-to-me-park-session");
    expect(solid.text).toContain(WIDGET_STYLE_MARKER);
  });
});

describe("widget shared contract", () => {
  it("requires only session-id", () => {
    expect(WIDGET_REQUIRED_ATTRIBUTES).toEqual(["session-id"]);
  });

  it("accepts trimmed session ids and rejects missing or blank values", () => {
    expect(requireWidgetSessionId(" ses_a ")).toBe("ses_a");
    expect(() => requireWidgetSessionId(null)).toThrow(
      /say-to-me-widget: missing required attribute session-id/,
    );
    expect(() => requireWidgetSessionId(" ")).toThrow(
      /say-to-me-widget: missing required attribute session-id/,
    );
  });
});

describe("widget HMR contract", () => {
  it("registers once at module scope behind one self-accepting HMR boundary", () => {
    const source = readFileSync(new URL("./widget-hmr.ts", import.meta.url), "utf8");
    expect(source).toContain('from "./widget-register.tsx"');
    expect(source).toContain("registerWidget()");
    expect(source.match(/import\.meta\.hot\.accept\(\)/g)).toHaveLength(1);
  });

  it("scopes the Solid compiler to embed TSX modules", () => {
    const source = readFileSync(new URL("../../../astro.config.mjs", import.meta.url), "utf8");
    expect(source).toContain('import solid from "vite-plugin-solid"');
    expect(source).toContain("/server\\/embed\\/solid\\/.*\\.tsx$/");
    expect(source).toContain("react({ exclude: solidEmbedInclude })");
    expect(source).toContain("solid({");
    expect(source).toContain("include: solidEmbedInclude");
  });
});
