/** @jsxImportSource solid-js */
import { createSignal, onCleanup } from "solid-js";

const COPY_CONFIRMATION_MS = 2_000;

export function IdButton(props: { sessionId: string | null }) {
  const [copied, setCopied] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  onCleanup(() => {
    disposed = true;
    clearTimeout(resetTimer);
  });

  async function copySessionMention(): Promise<void> {
    const sessionId = props.sessionId?.trim();
    const clipboard = navigator.clipboard;
    if (!sessionId) return;
    if (!clipboard?.writeText) {
      console.error("[say-to-me-widget] Clipboard API unavailable");
      return;
    }

    try {
      await clipboard.writeText(`say-to-me(${sessionId})`);
      if (disposed) return;
      setCopied(true);
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => setCopied(false), COPY_CONFIRMATION_MS);
    } catch (error) {
      console.error("[say-to-me-widget] Failed to copy session mention", error);
    }
  }

  return (
    <button
      type="button"
      class="stm-id-btn"
      data-testid="copy-session-id-button"
      aria-label="Copy Say To Me session mention"
      title="Copy Say To Me session mention"
      disabled={!props.sessionId?.trim()}
      onClick={() => void copySessionMention()}
    >
      {copied() ? (
        <svg
          data-testid="id-copy-confirmation"
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="14"
          height="14"
        >
          <path
            d="M20 6 9 17l-5-5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            opacity="0.8"
          />
        </svg>
      ) : (
        "ID"
      )}
    </button>
  );
}
