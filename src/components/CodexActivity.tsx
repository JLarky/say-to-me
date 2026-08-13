import { useMemo } from "react";
import * as stylex from "@stylexjs/stylex";

import { CODEX_SESSION_ID } from "../external-cli/session-patterns.ts";
import { card } from "../styles/chrome.stylex.ts";
import { queue } from "../styles/feed.stylex.ts";
import type { ExternalCliActivitySnapshot } from "../types.ts";
import { ExternalCliActivityBody } from "./ExternalCliActivityBody.tsx";
import { activityStyles } from "./OpenCodeActivityPreview.tsx";

const CODEX_ID = new RegExp(`^${CODEX_SESSION_ID}$`, "i");

const styles = stylex.create({
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    rowGap: "0.6rem",
    columnGap: "0.6rem",
  },
  pill: {
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderRadius: "999px",
    paddingTop: "0.1rem",
    paddingRight: "0.55rem",
    paddingBottom: "0.1rem",
    paddingLeft: "0.55rem",
    borderWidth: "1px",
    borderStyle: "solid",
  },
  pillBusy: { color: "#b45309", borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.14)" },
  pillIdle: { color: "#6b7280", borderColor: "#d1d5db", backgroundColor: "transparent" },
  muted: { color: "#9ca3af", fontSize: "0.85rem", margin: 0 },
});

function cardKindStyle(kind: ExternalCliActivitySnapshot["items"][number]["kind"]) {
  if (kind === "tool") return activityStyles.cardTool;
  if (kind === "thinking") return activityStyles.cardThinking;
  return activityStyles.cardMessage;
}

export function CodexActivity({
  activity,
  sessionId,
}: {
  activity: ExternalCliActivitySnapshot | null;
  sessionId: string | undefined;
}) {
  const isCodex = Boolean(sessionId && CODEX_ID.test(sessionId));
  const snippetStyleProps = useMemo(() => stylex.props(activityStyles.snippet), []);

  if (!isCodex) return null;
  const items = [...(activity?.items ?? [])].reverse();

  return (
    <section {...stylex.props(card.base, queue.panel)}>
      <div {...stylex.props(styles.heading)}>
        <h2 {...stylex.props(queue.headingH2)}>Codex activity</h2>
        <span {...stylex.props(styles.pill, activity?.busy ? styles.pillBusy : styles.pillIdle)}>
          {activity?.busy ? "busy" : "idle"}
        </span>
      </div>
      {items.length === 0 ? (
        <p {...stylex.props(styles.muted)}>No activity yet.</p>
      ) : (
        <div {...stylex.props(activityStyles.carousel)}>
          {items.map((item, index) => (
            <article
              key={`${item.timestamp ?? "t"}-${index}`}
              {...stylex.props(activityStyles.card, cardKindStyle(item.kind))}
              aria-label={`Codex activity ${index + 1}`}
            >
              <ExternalCliActivityBody item={item} styleProps={snippetStyleProps} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
