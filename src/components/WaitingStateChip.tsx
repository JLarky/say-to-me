import { safeResponseJson } from "@say-to-me/runtime-validation";
import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";

import { controls } from "../styles/controls.stylex.ts";
import { badge } from "../styles/feed.stylex.ts";
import { WaitingStatePayload } from "../types.ts";

const styles = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: "0.45rem",
    columnGap: "0.6rem",
    marginTop: "0.6rem",
    fontSize: "0.85rem",
  },
  reason: {
    color: "#888",
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  heuristic: {
    opacity: 0.65,
  },
});

const stateLabels: Record<WaitingStatePayload["state"], string> = {
  needs_answer: "Needs answer",
  needs_direction: "Needs direction",
  can_continue: "Can continue",
  working: "Working",
  blocked: "Blocked",
  review: "Review",
  unknown: "Unknown",
};

/**
 * Waiting-state chip (#116 tracer bullet): shows what the agent is waiting for
 * and the suggested next action. Refreshes when the message list changes (via
 * `refreshKey`) plus a slow poll so busy→idle transitions surface without a
 * new message.
 */
export function WaitingStateChip({
  sessionId,
  refreshKey,
  onCannedMessage,
}: {
  sessionId?: string;
  refreshKey: string;
  onCannedMessage: (text: string) => void;
}) {
  const [waiting, setWaiting] = useState<WaitingStatePayload | null>(null);

  const canShow = Boolean(sessionId && sessionId !== "default" && sessionId.startsWith("ses_"));

  useEffect(() => {
    if (!sessionId || !canShow) return;
    let cancelled = false;

    async function refresh() {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/waiting-state`);
        if (!response.ok) return;
        const payload = await safeResponseJson(response, WaitingStatePayload);
        if (!cancelled) setWaiting(payload);
      } catch {
        if (!cancelled) setWaiting(null);
      }
    }

    void refresh();
    const timer = setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, canShow, refreshKey]);

  if (!canShow || !waiting) return null;

  return (
    <div {...stylex.props(styles.row)} aria-label="Agent waiting state">
      <span
        {...stylex.props(
          badge.base,
          waiting.state === "can_continue" && badge.done,
          (waiting.state === "needs_answer" ||
            waiting.state === "needs_direction" ||
            waiting.state === "working") &&
            badge.pending,
          waiting.state === "blocked" && badge.failed,
          waiting.source !== "jinx" && styles.heuristic,
        )}
        title={waiting.source === "jinx" ? `${waiting.reason} (via Jinx)` : waiting.reason}
      >
        {waiting.source === "jinx" ? "✦ " : ""}
        {stateLabels[waiting.state]}
      </span>
      <span {...stylex.props(styles.reason)}>{waiting.reason}</span>
      {waiting.state === "can_continue" ? (
        <button
          {...stylex.props(
            controls.button,
            controls.secondary,
            controls.compact,
            controls.autoMobileWidth,
          )}
          onClick={() => onCannedMessage("please continue")}
          type="button"
        >
          {waiting.action ?? "Send please continue"}
        </button>
      ) : null}
    </div>
  );
}
