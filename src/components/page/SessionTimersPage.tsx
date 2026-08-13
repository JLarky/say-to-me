import { useEffect, useState } from "react";
import { useLoaderData, useParams } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { JarvisTimersPanel } from "../JarvisTimers.tsx";
import { PageShell } from "../PageShell.tsx";
import { sessionLoader } from "../../loaders.ts";
import { sessionListLabel, showSessionIdSubline } from "../../session-label.ts";
import { card, misc, text as textStyles } from "../../styles/chrome.stylex.ts";
import { session as sessionStyles } from "../../styles/session.stylex.ts";
import { useSessions } from "../../use-sessions.ts";
import { projectIdentity } from "../../utils.ts";

export function SessionTimersPage() {
  const { sessionId } = useParams();
  const { initialSession } = useLoaderData<typeof sessionLoader>();
  const { sessions } = useSessions({ includeCachedStatus: true, live: true });
  const [error, setError] = useState("");
  const session = sessions.find((item) => item.id === sessionId) ?? initialSession;
  const headingLabel = session ? sessionListLabel(session) : sessionId || "Timers";
  const opencodeTitle = session?.opencodeTitle ?? null;
  const identity = projectIdentity({
    id: session?.id ?? sessionId ?? "default",
    opencodeTitle,
  });

  useEffect(() => {
    document.title = `Timers — ${headingLabel} — Say To Me`;
  }, [headingLabel]);

  return (
    <PageShell
      identity={identity}
      currentSessionId={sessionId}
      eyebrow="Timers"
      backTo={sessionId ? `/ses/${sessionId}` : "/"}
      backLabel="Back to session"
      hero={
        <>
          <h1 {...stylex.props(textStyles.title, sessionStyles.title)}>{headingLabel}</h1>
          {session && showSessionIdSubline(session) && sessionId ? (
            <p {...stylex.props(sessionStyles.idSub)}>{sessionId}</p>
          ) : null}
          <p {...stylex.props(textStyles.lede)}>
            Create, review, pause, or stop scheduled prompts for this session.
          </p>
        </>
      }
    >
      {error ? <div {...stylex.props(misc.error)}>{error}</div> : null}
      {sessionId ? (
        <JarvisTimersPanel
          createHref={`/jarvis/timers/new?sessionId=${encodeURIComponent(sessionId)}`}
          emptyText="No timers target this session."
          sessionId={sessionId}
          sessions={sessions}
          setError={setError}
          summary="Scheduled prompts for this session."
          title="Saved timers"
        />
      ) : (
        <section {...stylex.props(card.base)}>
          <p {...stylex.props(misc.empty)}>Session not found.</p>
        </section>
      )}
    </PageShell>
  );
}
