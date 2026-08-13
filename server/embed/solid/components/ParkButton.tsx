/** @jsxImportSource solid-js */
import {
  EMBED_WIDGET_PARK_SESSION_DETAIL_BASE,
  EMBED_WIDGET_PARK_SESSION_EVENT,
} from "../widget-shared.ts";

function dispatchParkSessionEvent(el: HTMLElement, sessionId: string): void {
  el.dispatchEvent(
    new CustomEvent(EMBED_WIDGET_PARK_SESSION_EVENT, {
      bubbles: true,
      composed: true,
      detail: {
        ...EMBED_WIDGET_PARK_SESSION_DETAIL_BASE,
        sessionId,
      },
    }),
  );
}

export function ParkButton(props: { sessionId: string | null; el: HTMLElement }) {
  return (
    <button
      type="button"
      class="stm-park-btn"
      data-testid="park-session-button"
      aria-label="Park session"
      title="Park session"
      disabled={!props.sessionId}
      onClick={() => {
        if (props.sessionId) {
          dispatchParkSessionEvent(props.el, props.sessionId);
        }
      }}
    >
      P
    </button>
  );
}
