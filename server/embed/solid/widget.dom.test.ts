/** @vitest-environment jsdom */
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { EMBED_WIDGET_PARK_SESSION_EVENT, EMBED_WIDGET_TAG } from "./widget-shared.ts";
import { WIDGET_STYLE_ELEMENT_ID } from "./widget-styles.ts";
import { VOICE_WIDGET_STYLE_MARKER } from "./voice-widget-styles.ts";
import { enqueueVoiceAudio, resetVoiceAudioQueue } from "./voice-widget-audio.ts";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, EventListener[]>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

let classicScript: string;
let originalFetch: typeof fetch;
let originalEventSource: typeof EventSource | undefined;
let originalSpeechDescriptor: PropertyDescriptor | undefined;
let originalUtterance: typeof SpeechSynthesisUtterance | undefined;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function loadClassicScript(): string {
  return execFileSync(
    `${process.env.HOME}/.vite-plus/bin/vp`,
    ["exec", "node", "server/embed/solid/widget-build-classic.ts"],
    { encoding: "utf8", cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024 },
  );
}
function register() {
  // eslint-disable-next-line typescript/no-implied-eval
  new Function(classicScript)();
}
function payload(revision: number, text = "Owned note") {
  return {
    revision,
    messages: [
      {
        id: 42,
        author: "agent",
        text,
        createdAt: "2026-08-02T12:00:00Z",
        status: "queued",
        extraMarkdown: "**raw**",
        extraMarkdownHtml: "<p><strong>safe</strong></p>",
        attachments: [],
        sessions: [],
      },
    ],
  };
}
function mount(
  attrs: Record<string, string> = {
    "session-id": "t3_thread",
    "notes-base-url": "/api/voice-notes",
    "timers-base-url": "/api/say-to-me-timers",
  },
) {
  register();
  const host = document.createElement(EMBED_WIDGET_TAG);
  for (const [key, value] of Object.entries(attrs)) host.setAttribute(key, value);
  document.body.append(host);
  return host;
}

beforeAll(() => {
  classicScript = loadClassicScript();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  if (originalEventSource) globalThis.EventSource = originalEventSource;
  FakeEventSource.instances = [];
  if (originalSpeechDescriptor)
    Object.defineProperty(window, "speechSynthesis", originalSpeechDescriptor);
  else Reflect.deleteProperty(window, "speechSynthesis");
  if (originalUtterance) globalThis.SpeechSynthesisUtterance = originalUtterance;
  document.body.replaceChildren();
  document.getElementById(WIDGET_STYLE_ELEMENT_ID)?.remove();
});

describe("complete say-to-me-widget", () => {
  it("owns transport, renders toolbar/list, and injects all bare-host styles", async () => {
    originalFetch = globalThis.fetch;
    originalEventSource = globalThis.EventSource;
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            input instanceof Request && input.url.includes("timers") ? { timers: [] } : payload(1),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const parks: Event[] = [];
    document.addEventListener(EMBED_WIDGET_PARK_SESSION_EVENT, (event) => parks.push(event));
    const host = mount();
    await flush();
    await flush();
    expect(host.querySelector("[data-testid=copy-session-id-button]")).not.toBeNull();
    expect(host.querySelector("[data-testid=park-session-button]")).not.toBeNull();
    expect(host.querySelector(".stm-voice-note-row-text")?.textContent).toBe("Owned note");
    expect(host.querySelector(".stm-voice-note-markdown strong")?.textContent).toBe("safe");
    expect(host.dataset.bannerApiVersion).toBe("2");
    expect(host.dataset.speechActive).toBe("false");
    expect(host.querySelectorAll(".stm-voice-widget-toolbar")).toHaveLength(1);
    expect(host.querySelectorAll(".stm-voice-widget-title")).toHaveLength(1);
    expect(host.querySelectorAll(".stm-voice-collapse")).toHaveLength(1);
    expect(host.querySelectorAll("[data-testid=copy-session-id-button]")).toHaveLength(1);
    expect(host.querySelectorAll("[data-testid=park-session-button]")).toHaveLength(1);
    expect(
      host.querySelector(".stm-voice-widget-content .stm-voice-widget-missing") &&
        host.querySelector(".stm-voice-widget-content .stm-voice-widget-unavailable"),
    ).toBeFalsy();
    expect(document.getElementById("say-to-me-widget-markdown-styles")?.textContent).toContain(
      "say-to-me-widget",
    );
    expect(document.getElementById("say-to-me-widget-voice-styles")?.textContent).toContain(
      VOICE_WIDGET_STYLE_MARKER,
    );
    (host.querySelector("[data-testid=park-session-button]") as HTMLButtonElement).click();
    expect(parks).toHaveLength(1);
    expect((parks[0] as CustomEvent).detail).toMatchObject({
      source: "say-to-me-widget",
      version: 1,
      type: "park-session",
      sessionId: "t3_thread",
    });
  });

  it("dispatches a strict v2 usage prompt from the empty state", async () => {
    originalFetch = globalThis.fetch;
    originalEventSource = globalThis.EventSource;
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            input instanceof Request && input.url.includes("timers")
              ? { timers: [] }
              : { revision: 1, messages: [] },
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const usageEvents: CustomEvent[] = [];
    const onUsage = (event: Event) => usageEvents.push(event as CustomEvent);
    document.addEventListener("say-to-me-insert-usage-prompt", onUsage);
    const host = mount();
    await flush();
    await flush();
    const usage = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Tell your agent how to use Say To Me"),
    ) as HTMLButtonElement | undefined;
    expect(usage).not.toBeUndefined();
    usage?.click();
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]?.detail).toMatchObject({
      source: "say-to-me-widget",
      version: 2,
      type: "insert-usage-prompt",
      prompt: expect.stringContaining("t3_thread"),
    });
    document.removeEventListener("say-to-me-insert-usage-prompt", onUsage);
  });

  it("opens exactly one SSE after ready and rejects stale revisions", async () => {
    originalFetch = globalThis.fetch;
    originalEventSource = globalThis.EventSource;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payload(2)), { status: 200 }));
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const host = mount();
    await flush();
    await flush();
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0]!.emit("snapshot", payload(1, "stale"));
    await flush();
    expect(host.querySelector(".stm-voice-note-row-text")?.textContent).toBe("Owned note");
    FakeEventSource.instances[0]!.emit("message", payload(3, "new"));
    await flush();
    expect(host.querySelector(".stm-voice-note-row-text")?.textContent).toBe("new");
  });

  it("renders unavailable/missing configuration without throwing", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 }));
    const host = mount();
    await flush();
    expect(host.querySelector(".stm-voice-widget-content")).not.toBeNull();
    const incomplete = mount({ "session-id": "t3_missing" });
    await flush();
    expect(incomplete.dataset.error).toMatch(/notes-base-url/);
    globalThis.fetch = vi.fn(async () => new Response("", { status: 503 }));
    const unavailable = mount();
    await flush();
    expect(unavailable.querySelector(".stm-voice-widget-unavailable")?.textContent).toBe(
      "Say To Me is unavailable.",
    );
    expect(unavailable.querySelector(".stm-voice-widget-missing")).toBeNull();
  });
  it("serializes audio and releases a queued task after the 120s-style timeout", async () => {
    vi.useFakeTimers();
    resetVoiceAudioQueue();
    let firstStarted = false;
    let secondStarted = false;
    const first = enqueueVoiceAudio(() => {
      firstStarted = true;
      return new Promise<void>(() => {});
    }, 120);
    const second = enqueueVoiceAudio(async () => {
      secondStarted = true;
    }, 120);
    await vi.advanceTimersByTimeAsync(119);
    expect(firstStarted).toBe(true);
    expect(secondStarted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    await first;
    expect(secondStarted).toBe(true);
    resetVoiceAudioQueue();
  });
  it("owns timer action endpoints and create validation defaults", async () => {
    originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
      if (url.includes("timers"))
        return new Response(
          JSON.stringify({
            timers: [
              {
                id: 7,
                title: "Check",
                message: "Now",
                status: "active",
                nextFireAt: Date.now() + 60_000,
                intervalMs: null,
              },
            ],
          }),
          { status: 200 },
        );
      return new Response(JSON.stringify(payload(1)), { status: 200 });
    });
    const host = mount();
    await flush();
    await flush();
    (host.querySelector(".stm-voice-timer-toggle") as HTMLButtonElement).click();
    await flush();
    const trigger = Array.from(host.querySelectorAll(".stm-voice-action")).find(
      (button) => button.textContent === "Trigger now",
    ) as HTMLButtonElement;
    trigger.click();
    await flush();
    expect(
      calls.some(
        (call) =>
          call.url.includes("/7/actions") &&
          call.method === "POST" &&
          call.body?.includes("trigger"),
      ),
    ).toBe(true);
    expect(
      (
        Array.from(host.querySelectorAll(".stm-voice-action")).find(
          (button) => button.textContent === "Pause",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        Array.from(host.querySelectorAll(".stm-voice-action")).find(
          (button) => button.textContent === "Resume",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(host.querySelector(`[aria-label="Timer title"]`)).toBeNull();
    (
      Array.from(host.querySelectorAll(".stm-voice-action")).find(
        (button) => button.textContent === "Create new timer",
      ) as HTMLButtonElement
    ).click();
    expect(host.querySelector(".stm-voice-timer-footer input")).not.toBeNull();
  });
  it("balances speech activity events and stops queued autoplay safely", async () => {
    originalFetch = globalThis.fetch;
    originalEventSource = globalThis.EventSource;
    originalSpeechDescriptor = Object.getOwnPropertyDescriptor(window, "speechSynthesis");
    originalUtterance = globalThis.SpeechSynthesisUtterance;
    let current: { onend: (() => void) | null } | null = null;
    const speech = {
      speaking: false,
      pending: false,
      getVoices: () => [{ name: "Google US English", lang: "en-US" }],
      addEventListener: () => {},
      removeEventListener: () => {},
      speak: (utterance: FakeUtterance) => {
        current = utterance;
        speech.speaking = true;
      },
      cancel: () => {
        speech.speaking = false;
      },
    };
    class FakeUtterance extends EventTarget {
      voice?: SpeechSynthesisVoice;
      lang = "";
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      constructor(readonly text: string) {
        super();
      }
    }
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: speech });
    globalThis.SpeechSynthesisUtterance =
      FakeUtterance as unknown as typeof SpeechSynthesisUtterance;
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            input instanceof Request && input.url.includes("timers") ? { timers: [] } : payload(1),
          ),
          { status: 200 },
        ),
    );
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
    const events: string[] = [];
    document.addEventListener("say-to-me-speech-started", () => events.push("started"));
    document.addEventListener("say-to-me-speech-ended", () => events.push("ended"));
    const host = mount();
    await flush();
    await flush();
    expect(events).toEqual(["started"]);
    expect(host.dataset.speechActive).toBe("true");
    const ended = current as { onend: (() => void) | null } | null;
    ended?.onend?.();
    speech.speaking = false;
    await flush();
    expect(events).toEqual(["started", "ended"]);
    expect(host.dataset.speechActive).toBe("false");
    expect(host.querySelectorAll(".stm-voice-widget-toolbar")).toHaveLength(1);
    expect(host.querySelectorAll(".stm-voice-widget-title")).toHaveLength(1);
    expect(host.querySelectorAll(".stm-voice-collapse")).toHaveLength(1);
    expect(host.querySelectorAll("[data-testid=copy-session-id-button]")).toHaveLength(1);
    expect(host.querySelectorAll("[data-testid=park-session-button]")).toHaveLength(1);
    expect(
      host.querySelector(".stm-voice-widget-content .stm-voice-widget-missing") &&
        host.querySelector(".stm-voice-widget-content .stm-voice-widget-unavailable"),
    ).toBeFalsy();
  });
  it("syncs cross-tab collapse using exact boolean storage encoding", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            input instanceof Request && input.url.includes("timers") ? { timers: [] } : payload(1),
          ),
          { status: 200 },
        ),
    );
    const host = mount({
      "session-id": "t3_storage",
      "notes-base-url": "/api/voice-notes",
      "storage-key": "t3code:say-to-me-banner-collapsed:v1",
    });
    await flush();
    await flush();
    const collapse = host.querySelector<HTMLButtonElement>(".stm-voice-collapse");
    collapse?.click();
    await flush();
    for (const selector of [
      ".stm-voice-sound-prompt",
      ".stm-voice-timer-panel",
      ".stm-voice-widget-content",
    ]) {
      const section = host.querySelector<HTMLElement>(selector);
      expect(section?.hidden).toBe(true);
      expect(section ? getComputedStyle(section).display : "").toBe("none");
      expect(section?.offsetParent).toBeNull();
    }
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "t3code:say-to-me-banner-collapsed:v1",
        newValue: "true",
      }),
    );
    await flush();
    expect(host.querySelector(".stm-voice-widget")?.getAttribute("data-collapsed")).toBe("true");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "t3code:say-to-me-banner-collapsed:v1",
        newValue: "false",
      }),
    );
    await flush();
    expect(host.querySelector(".stm-voice-widget")?.getAttribute("data-collapsed")).toBe("false");
  });
});
