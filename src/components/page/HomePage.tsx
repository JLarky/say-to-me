import { useEffect } from "react";
import { useNavigate } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { PageShell } from "../PageShell.tsx";
import { SessionList } from "../SessionList.tsx";
import { card, misc, text as textStyles } from "../../styles/chrome.stylex.ts";
import { composer as composerStyles, controls } from "../../styles/controls.stylex.ts";
import { queue } from "../../styles/feed.stylex.ts";
import { useSessions } from "../../use-sessions.ts";

function hrefForSession(sessionId: string | null | undefined): string {
  if (!sessionId) return "/";
  return sessionId === "default" ? "/default" : `/ses/${sessionId}`;
}

export function HomePage() {
  const navigate = useNavigate();
  const { sessions, error, deleteSession, updateSessionState } = useSessions({
    includeCachedStatus: true,
    live: true,
  });

  useEffect(() => {
    document.title = "Say To Me";
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.error("[sw] registration failed:", err);
      });
    }
  }, []);

  return (
    <PageShell
      eyebrow="Local TTS Sessions"
      hero={
        <>
          <h1 {...stylex.props(textStyles.title)}>Say To Me</h1>
          <p {...stylex.props(textStyles.lede)}>
            Your local voice sessions. Open an existing chat below, or start a new one from the
            sessions page.
          </p>
        </>
      }
    >
      <section {...stylex.props(card.base, composerStyles.root)}>
        <div {...stylex.props(composerStyles.actions)}>
          <button
            {...stylex.props(controls.button)}
            type="button"
            onClick={() => navigate("/sessions")}
          >
            Sessions
          </button>
          <button
            {...stylex.props(controls.button, controls.secondary)}
            type="button"
            onClick={() => navigate("/jarvis")}
          >
            Jarvis status
          </button>
          <button
            {...stylex.props(controls.button, controls.secondary)}
            type="button"
            onClick={() => navigate("/search")}
          >
            Search
          </button>
        </div>
      </section>

      {error ? <div {...stylex.props(misc.error)}>{error}</div> : null}

      <section {...stylex.props(card.base, queue.panel)}>
        <div {...stylex.props(queue.heading)}>
          <h2 {...stylex.props(queue.headingH2)}>Sessions</h2>
          <span {...stylex.props(queue.headingCount)}>{sessions.length}</span>
        </div>
        <SessionList
          sessions={sessions}
          onOpen={(id) => navigate(hrefForSession(id))}
          onDelete={deleteSession}
          onStateChange={updateSessionState}
          onFilter={(href) => navigate(href)}
        />
      </section>
    </PageShell>
  );
}
