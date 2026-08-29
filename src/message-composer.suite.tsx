/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MessageComposer } from "./components/MessageComposer.tsx";
import { NotesPageContent } from "./components/NotesPages.tsx";
import { OpenCodeStatusBadge, SessionStatusControls } from "./components/SessionStatusControls.tsx";
import type { Message } from "./types.ts";
import { openCodeStatuses } from "./types.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const noop = () => {};

describe("MessageComposer", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    localStorage.clear();
    vi.useRealTimers();
    container = undefined;
    root = undefined;
  });

  it("clears and submits an optimistic message immediately", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let resolveSend: (() => void) | undefined;
    let sentMessage: Message | undefined;
    const onSend = (message: Message): Promise<void> => {
      sentMessage = message;
      return new Promise((resolve) => {
        resolveSend = resolve;
      });
    };

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="hello optimistic"
          onSend={onSend}
          pendingId={() => "pending-test"}
          sessionId="default"
        />,
      );
    });

    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(textarea.value).toBe("");
    expect(sentMessage).toMatchObject({
      id: "pending-test",
      author: "user",
      sessionId: "default",
      text: "hello optimistic",
      status: "pending",
      pending: true,
    });

    await act(async () => {
      resolveSend?.();
    });
  });

  it("focuses the composer at the end after appending canned text", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const appendTextRef = React.createRef<((text: string) => void) | null>();

    await act(async () => {
      root!.render(
        <MessageComposer
          appendTextRef={appendTextRef}
          initialText="existing draft"
          onSend={noop}
          sessionId="default"
        />,
      );
    });

    const textarea = container.querySelector("textarea")!;
    textarea.blur();

    await act(async () => {
      appendTextRef.current?.("quick reply");
    });

    expect(textarea.value).toBe("existing draft\nquick reply");
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(textarea.value.length);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
  });

  it("previews leading session mentions as composer cards", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const sessionId = "ses_12f94ae96ffepCN7Wdi3ZUA7zl";

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText={`say-to-me(${sessionId}, E to E test) reply okay 321`}
          onSend={noop}
          sessionId="default"
        />,
      );
    });

    const attachedSessions = container.querySelector('[aria-label="Attached sessions"]');
    expect(attachedSessions?.textContent).toContain("E to E test");
    expect(attachedSessions?.textContent).toContain(sessionId);
  });

  it("previews leading raw session ids as composer cards", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const sessionId = "ses_12f94ae96ffepCN7Wdi3ZUA7zl";

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText={`${sessionId} reply okay`}
          onSend={noop}
          sessionId="default"
        />,
      );
    });

    const attachedSessions = container.querySelector('[aria-label="Attached sessions"]');
    expect(attachedSessions?.textContent).toContain(sessionId);
  });

  it("submits leading raw session ids as relays with stripped text", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const targetSessionId = "ses_12f94ae96ffepCN7Wdi3ZUA7zl";
    let sentMessage: Message | undefined;

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText={`${targetSessionId} please sleep 5 seconds`}
          onSend={(message) => {
            sentMessage = message;
          }}
          pendingId={() => "pending-relay"}
          sessionId="default"
        />,
      );
    });

    await act(async () => {
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(sentMessage).toMatchObject({
      id: "pending-relay",
      text: "please sleep 5 seconds",
      notifyOnCompletion: true,
      targetSessionId,
    });
  });

  it("does not offer notify-on-idle when an active idle wait already exists for the target", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const targetSessionId = "ses_12f94ae96ffepCN7Wdi3ZUA7zl";
    let sentMessage: Message | undefined;

    await act(async () => {
      root!.render(
        <MessageComposer
          activeIdleTargetSessionIds={[targetSessionId]}
          initialText={`${targetSessionId} please sleep 5 seconds`}
          onSend={(message) => {
            sentMessage = message;
          }}
          pendingId={() => "pending-relay-already-waiting"}
          sessionId="default"
        />,
      );
    });

    expect(
      container.querySelector('input[aria-label="Notify when target session becomes idle"]'),
    ).toBeNull();
    expect(container.textContent).toContain("Already waiting for this session to go idle");

    await act(async () => {
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(sentMessage).toMatchObject({
      id: "pending-relay-already-waiting",
      text: "please sleep 5 seconds",
      notifyOnCompletion: false,
      targetSessionId,
    });
  });

  it("submits forwarded messages with notify-on-completion disabled when unchecked", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const targetSessionId = "ses_12f94ae96ffepCN7Wdi3ZUA7zl";
    let sentMessage: Message | undefined;

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText={`${targetSessionId} please sleep 5 seconds`}
          onSend={(message) => {
            sentMessage = message;
          }}
          pendingId={() => "pending-relay-no-notify"}
          sessionId="default"
        />,
      );
    });

    const notifyCheckbox = container.querySelector(
      'input[aria-label="Notify when target session becomes idle"]',
    ) as HTMLInputElement;
    expect(notifyCheckbox.checked).toBe(true);

    await act(async () => {
      notifyCheckbox.click();
    });

    await act(async () => {
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(sentMessage).toMatchObject({
      id: "pending-relay-no-notify",
      text: "please sleep 5 seconds",
      notifyOnCompletion: false,
      targetSessionId,
    });
  });

  it("submits leading aliased session mentions as relays with stripped text", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const targetSessionId = "ses_12e688222ffeUE0jc3PK76cS8r";
    let sentMessage: Message | undefined;

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText={`say-to-me(${targetSessionId}, effect expert) ping me once you are done`}
          onSend={(message) => {
            sentMessage = message;
          }}
          pendingId={() => "pending-aliased-relay"}
          sessionId="default"
        />,
      );
    });

    await act(async () => {
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(sentMessage).toMatchObject({
      id: "pending-aliased-relay",
      text: "ping me once you are done",
      notifyOnCompletion: true,
      targetSessionId,
    });
  });

  it("does not preview non-leading session mentions as composer cards", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="reply say-to-me(ses_12f94ae96ffepCN7Wdi3ZUA7zl, E to E test)"
          onSend={noop}
          sessionId="default"
        />,
      );
    });

    expect(container.querySelector('[aria-label="Attached sessions"]')).toBeNull();
  });

  it("does not preview raw session ids without trailing whitespace", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <MessageComposer initialText="ses_12f94ae96ffe okay" onSend={noop} sessionId="default" />,
      );
    });

    expect(container.querySelector('[aria-label="Attached sessions"]')).toBeNull();
  });

  it("pastes images into removable chips and sends them as an images[] array", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const filePath = "/tmp/00000000-0000-4000-8000-000000000000.png";
    const originalFetch = globalThis.fetch;
    const originalRandomUUID = crypto.randomUUID.bind(crypto);
    const requests: RequestInit[] = [];
    globalThis.fetch = ((_url, init) => {
      requests.push(init || {});
      return Promise.resolve(
        Response.json({
          attachment: { filePath, originalName: "pasted-image.png", mimeType: "image/png" },
        }),
      );
    }) as typeof fetch;
    crypto.randomUUID = () => "00000000-0000-4000-8000-000000000000";
    let sentMessage: Message | undefined;

    try {
      await act(async () => {
        root!.render(
          <MessageComposer
            initialText="look at this"
            onSend={(message) => {
              sentMessage = message;
            }}
            sessionId="default"
          />,
        );
      });

      const textarea = container.querySelector("textarea")!;
      const imageFile = new File([new Uint8Array([1])], "clipboard.png", { type: "image/png" });
      const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, "clipboardData", { value: { files: [imageFile] } });

      await act(async () => {
        textarea.dispatchEvent(pasteEvent);
      });

      expect(pasteEvent.defaultPrevented).toBe(true);
      // The pasted path becomes a removable chip; the text body is untouched.
      expect(textarea.value).toBe("look at this");
      expect(container.querySelector(`[aria-label="Remove ${filePath.slice(5)}"]`)).not.toBeNull();
      expect(requests[0]).toMatchObject({
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "X-File-Name": "clipboard.png",
          "X-Target-Path": filePath,
        },
      });

      await act(async () => {
        container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
      });

      expect(sentMessage).toMatchObject({ text: "look at this", images: [filePath] });
      expect(sentMessage?.text).not.toContain(filePath);
      expect(textarea.value).toBe("");
      expect(container.querySelector(`[aria-label="Remove ${filePath.slice(5)}"]`)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      crypto.randomUUID = originalRandomUUID;
    }
  });

  it("restores saved notes into the note editor", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <NotesPageContent
            initialNotes={[
              {
                id: 2,
                sessionId: "default",
                content: "latest note",
                createdAt: "2026-05-14 12:00:00",
              },
              {
                id: 1,
                sessionId: "default",
                content: "older note",
                createdAt: "2026-05-14 11:00:00",
              },
            ]}
            initialSession={{ id: "default" }}
            sessionId="default"
          />
        </MemoryRouter>,
      );
    });

    const textarea = container.querySelector("textarea")!;
    expect(textarea.value).toBe("latest note");
    const restoreButtons = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => button.textContent === "Restore",
    );
    expect(restoreButtons[0].disabled).toBe(true);
    expect(restoreButtons[1].disabled).toBe(false);

    await act(async () => {
      restoreButtons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(textarea.value).toBe("older note");
    expect(restoreButtons[0].disabled).toBe(false);
    expect(restoreButtons[1].disabled).toBe(true);
  });

  it("deletes saved notes from the notes list", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch;

    try {
      await act(async () => {
        root!.render(
          <MemoryRouter>
            <NotesPageContent
              initialNotes={[
                {
                  id: 2,
                  sessionId: "default",
                  content: "latest note",
                  createdAt: "2026-05-14 12:00:00",
                },
                {
                  id: 1,
                  sessionId: "default",
                  content: "older note",
                  createdAt: "2026-05-14 11:00:00",
                },
              ]}
              initialSession={{ id: "default" }}
              sessionId="default"
            />
          </MemoryRouter>,
        );
      });

      expect(container.textContent).toContain("older note");

      await act(async () => {
        [...container!.querySelectorAll<HTMLButtonElement>("button")]
          .filter((button) => button.textContent === "Delete")[1]
          .dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(container.textContent).not.toContain("older note");
      expect(container.textContent).toContain("latest note");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("dings from the send button but does not submit empty messages", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let dingCount = 0;
    let sendCount = 0;

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="   "
          onSend={() => {
            sendCount += 1;
          }}
          onSendDing={() => {
            dingCount += 1;
            return Promise.resolve(false);
          }}
          sessionId="default"
        />,
      );
    });

    await act(async () => {
      container!.querySelector("button[type='submit']")!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
        }),
      );
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(dingCount).toBe(1);
    expect(sendCount).toBe(0);
  });

  it("dings for keyboard submits", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let dingCount = 0;

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="keyboard message"
          onSend={noop}
          onSendDing={() => {
            dingCount += 1;
            return Promise.resolve(false);
          }}
          sessionId="default"
        />,
      );
    });

    await act(async () => {
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(dingCount).toBe(1);
  });

  it("labels the send button Queue while OpenCode is pending and Send when forced", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="hold for idle"
          onSend={noop}
          opencodeStatus="pending"
          sessionId="default"
        />,
      );
    });

    const sendButton = container.querySelector("button[type='submit']")!;
    expect(sendButton.textContent).toBe("Queue");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }));
    });
    expect(sendButton.textContent).toBe("Send");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta", metaKey: false }));
    });
    expect(sendButton.textContent).toBe("Queue");
  });

  it("force-sends when the send button is clicked with Command held", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let sentMessage: Message | undefined;

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="interrupt now"
          onSend={(message) => {
            sentMessage = message;
          }}
          opencodeStatus="pending"
          sessionId="default"
        />,
      );
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta", metaKey: true }));
    });
    await act(async () => {
      container!
        .querySelector("button[type='submit']")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(sentMessage?.forceOpencode).toBe(true);
  });

  it("queues when the send button is clicked without a modifier", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let sentMessage: Message | undefined;

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="hold for idle"
          onSend={(message) => {
            sentMessage = message;
          }}
          opencodeStatus="pending"
          sessionId="default"
        />,
      );
    });

    const sendButton = container.querySelector("button[type='submit']")!;
    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(sentMessage?.forceOpencode).toBeUndefined();
  });

  it("arms force send on long press and sends on release", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let sentMessage: Message | undefined;

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="interrupt from mobile"
          onSend={(message) => {
            sentMessage = message;
          }}
          opencodeStatus="pending"
          sessionId="default"
        />,
      );
    });

    const sendButton = container.querySelector("button[type='submit']")!;
    expect(sendButton.textContent).toBe("Queue");

    await act(async () => {
      sendButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      vi.advanceTimersByTime(700);
    });
    expect(sendButton.textContent).toBe("Send");
    expect(sentMessage).toBeUndefined();

    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sentMessage?.forceOpencode).toBe(true);
    expect(sendButton.textContent).toBe("Queue");
  });

  it("keeps force send armed if the pointer leaves after a long press", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let sentMessage: Message | undefined;

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="interrupt despite touch drift"
          onSend={(message) => {
            sentMessage = message;
          }}
          opencodeStatus="pending"
          sessionId="default"
        />,
      );
    });

    const sendButton = container.querySelector("button[type='submit']")!;

    await act(async () => {
      sendButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      vi.advanceTimersByTime(700);
      sendButton.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    });

    await act(async () => {
      sendButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sentMessage?.forceOpencode).toBe(true);
  });

  it("keeps a short tap on the queue button queued", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let sentMessage: Message | undefined;

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="wait for idle"
          onSend={(message) => {
            sentMessage = message;
          }}
          opencodeStatus="pending"
          sessionId="default"
        />,
      );
    });

    const sendButton = container.querySelector("button[type='submit']")!;
    await act(async () => {
      sendButton.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      vi.advanceTimersByTime(100);
      sendButton.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      sendButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });

    expect(sentMessage?.forceOpencode).toBeUndefined();
  });

  it("labels the send button Send when OpenCode is idle", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <MessageComposer
          initialText="go now"
          onSend={noop}
          opencodeStatus="idle"
          sessionId="default"
        />,
      );
    });

    expect(container.querySelector("button[type='submit']")?.textContent).toBe("Send");
  });

  it("shows and toggles shush mode in composer options", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let nextMode: string | undefined;

    await act(async () => {
      root!.render(
        <MessageComposer
          agentReplyMode="shush"
          initialText="quiet please"
          onSend={noop}
          onSetAgentReplyMode={(value) => {
            nextMode = value;
          }}
          sessionId="default"
        />,
      );
    });

    expect(container.querySelector("summary")?.textContent).toContain("shush");
    const agentRepliesSelect = [...container.querySelectorAll<HTMLSelectElement>("select")].find(
      (select) => select.parentElement?.textContent?.includes("Agent replies"),
    );
    expect(agentRepliesSelect?.value).toBe("shush");

    await act(async () => {
      agentRepliesSelect!.value = "manual";
      agentRepliesSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(nextMode).toBe("manual");
  });

  it.each(openCodeStatuses)("renders OpenCode %s status", (status) => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(<OpenCodeStatusBadge status={status} />);
    });

    expect(container.textContent).toContain(`OpenCode ${status}`);
    expect(container.querySelector(`[data-opencode-status="${status}"]`)).not.toBeNull();
  });

  it("renders gray Voice only badge for voice backend", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(<OpenCodeStatusBadge status="unavailable" backend="voice" />);
    });

    expect(container.textContent).toContain("Voice only");
    expect(container.textContent).not.toContain("OpenCode unavailable");
    expect(container.querySelector(`[data-opencode-status="voice-only"]`)).not.toBeNull();
  });

  it("keeps OpenCode unavailable label for none/opencode backends", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(<OpenCodeStatusBadge status="unavailable" backend="none" />);
    });

    expect(container.textContent).toContain("OpenCode unavailable");
    expect(container.textContent).not.toContain("Voice only");
  });

  it("shows Voice only from SessionStatusControls for voice sessions", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <SessionStatusControls
          session={{ id: "vo_shopping-notes", backend: "voice" }}
          sessionId={undefined}
        />,
      );
    });

    expect(container.textContent).toContain("Voice only");
    expect(container.querySelector(`[data-session-backend="voice"]`)).not.toBeNull();
  });

  it("renders Stop OpenCode when the session is pending or retrying", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <SessionStatusControls
          session={{
            id: "ses_e946608d8f44iE5XvXLyK7tlO9",
            opencodeStatus: "idle",
            backend: "opencode",
          }}
          sessionId={undefined}
        />,
      );
    });
    expect(container.textContent).not.toContain("Stop OpenCode");

    act(() => {
      root!.render(
        <SessionStatusControls
          session={{
            id: "ses_e946608d8f44iE5XvXLyK7tlO9",
            backend: "opencode",
            opencodeStatus: "pending",
          }}
          sessionId={undefined}
        />,
      );
    });
    expect(container.textContent).toContain("Stop OpenCode");

    act(() => {
      root!.render(
        <SessionStatusControls
          session={{
            id: "ses_e946608d8f44iE5XvXLyK7tlO9",
            backend: "opencode",
            opencodeStatus: "retrying",
          }}
          sessionId={undefined}
        />,
      );
    });
    expect(container.textContent).toContain("Stop OpenCode");
  });

  it("only renders Stop Cursor when the session is busy", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const cursorSessionId = "cur_e6ca1259-5b7f-4de3-afd5-a877811435cb";

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionStatusControls
            externalCliActivity={{ items: [], lastTimestamp: null, busy: false }}
            session={{ id: cursorSessionId, backend: "cursor" }}
            sessionId={cursorSessionId}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Stop Cursor");

    root!.unmount();
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionStatusControls
            externalCliActivity={{ items: [], lastTimestamp: null, busy: true }}
            session={{ id: cursorSessionId, backend: "cursor" }}
            sessionId={cursorSessionId}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Stop Cursor");
  });

  it("only renders Stop Claude when the session is busy", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const claudeSessionId = "cc_5c708e22-807e-4579-807a-b56d8e4341e1";

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionStatusControls
            externalCliActivity={{ items: [], lastTimestamp: null, busy: false }}
            session={{ id: claudeSessionId, backend: "claude" }}
            sessionId={claudeSessionId}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Stop Claude");

    root!.unmount();
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <SessionStatusControls
            externalCliActivity={{ items: [], lastTimestamp: null, busy: true }}
            session={{ id: claudeSessionId, backend: "claude" }}
            sessionId={claudeSessionId}
          />
        </MemoryRouter>,
      );
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Stop Claude");
  });

  it("summarizes OpenCode model in composer options", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const originalFetch = globalThis.fetch;

    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "/api/sessions/ses_e946608d8f44iE5XvXLyK7tlO9/models") {
        return Promise.resolve(Response.json({ models: [] }));
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    }) as typeof fetch;

    try {
      await act(async () => {
        root!.render(
          <MessageComposer
            onSend={noop}
            sessionId="ses_e946608d8f44iE5XvXLyK7tlO9"
            session={{
              id: "ses_e946608d8f44iE5XvXLyK7tlO9",
              backend: "opencode",
              opencodeAgent: "build",
              opencodeModelProvider: "github-copilot",
              opencodeModel: "fast-model",
            }}
          />,
        );
        await Promise.resolve();
      });

      expect(container.querySelector("summary")?.textContent).toContain("copilot/fast-model");
      expect(container.textContent).not.toContain("build /");
      expect(
        container.querySelector('[data-opencode-agent-model="copilot/fast-model"]'),
      ).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
