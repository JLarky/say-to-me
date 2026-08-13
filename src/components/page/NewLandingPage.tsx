import { useEffect } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "react-router";

import { styles } from "./NewLandingPage.stylex.ts";

function ArrowIcon({ inButton = false }: { inButton?: boolean }) {
  return (
    <svg
      {...stylex.props(styles.arrowIcon, inButton && styles.buttonArrowIcon)}
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}

function MarkIcon() {
  return (
    <svg {...stylex.props(styles.markIcon)} viewBox="0 0 28 28" aria-hidden="true">
      <path d="M7 15.5a7 7 0 1 1 14 0" />
      <path d="M10.5 15.5a3.5 3.5 0 1 1 7 0" />
      <path d="M14 15.5v7" />
    </svg>
  );
}

export function NewLandingPage() {
  useEffect(() => {
    document.title = "Say To Me — A home for agent work";
  }, []);

  return (
    <div {...stylex.props(styles.root)}>
      <main {...stylex.props(styles.page, styles.signal)}>
        <nav {...stylex.props(styles.nav)}>
          <Link {...stylex.props(styles.logo)} to="/new" aria-label="Say To Me home">
            <span {...stylex.props(styles.logoMark)}>
              <MarkIcon />
            </span>
            <span>Say To Me</span>
          </Link>
          <div {...stylex.props(styles.navCenter)} aria-label="Primary navigation">
            <a {...stylex.props(styles.navLink)} href="#how">
              How it works
            </a>
            <a {...stylex.props(styles.navLink)} href="#spaces">
              Spaces
            </a>
            <a {...stylex.props(styles.navLink)} href="#agents">
              Agents
            </a>
          </div>
          <Link {...stylex.props(styles.navAction)} to="/dashboard">
            Open workspace <ArrowIcon />
          </Link>
        </nav>

        <section {...stylex.props(styles.hero)}>
          <div {...stylex.props(styles.copy)}>
            <div {...stylex.props(styles.kicker)}>
              <span {...stylex.props(styles.kickerDot)} /> A home for agent work
            </div>
            <h1 {...stylex.props(styles.heading)}>
              See the whole system.
              <br />
              <em {...stylex.props(styles.headingEmphasis)}>Move one thing.</em>
            </h1>
            <p {...stylex.props(styles.intro)}>
              Organize projects, repositories, worktrees, and AI sessions into living spaces that
              make parallel work feel legible.
            </p>
            <div {...stylex.props(styles.actions)}>
              <Link {...stylex.props(styles.primaryButton)} to="/dashboard">
                <span>Create your first space</span>
                <ArrowIcon inButton />
              </Link>
              <button {...stylex.props(styles.textButton)} type="button">
                Watch the overview <span {...stylex.props(styles.textButtonTime)}>01:24</span>
              </button>
            </div>
            <div {...stylex.props(styles.proof)}>
              <div {...stylex.props(styles.avatarStack)}>
                <i {...stylex.props(styles.proofAvatar, styles.firstProofAvatar)}>Y</i>
                <i {...stylex.props(styles.proofAvatar, styles.secondProofAvatar)}>M</i>
                <i {...stylex.props(styles.proofAvatar, styles.thirdProofAvatar)}>K</i>
                <i {...stylex.props(styles.proofAvatar)}>+6</i>
              </div>
              <span>One calm view across every agent and repo</span>
            </div>
          </div>

          <div
            {...stylex.props(styles.orbitScene)}
            aria-label="A spatial map of active project work"
          >
            <div {...stylex.props(styles.orbitGlow)} />
            <div {...stylex.props(styles.orbitRing, styles.ringOne)} />
            <div {...stylex.props(styles.orbitRing, styles.ringTwo)} />
            <div {...stylex.props(styles.orbitRing, styles.ringThree)} />
            <div {...stylex.props(styles.coreCard)}>
              <div {...stylex.props(styles.coreTop)}>
                <span {...stylex.props(styles.coreIcon)}>S</span>
                <span {...stylex.props(styles.liveDot)} /> Live space
              </div>
              <strong {...stylex.props(styles.coreTitle)}>Say To Me</strong>
              <small {...stylex.props(styles.coreMeta)}>3 repos · 7 agents</small>
              <div {...stylex.props(styles.coreBars)}>
                <i {...stylex.props(styles.coreBar, styles.coreBarOne)} />
                <i {...stylex.props(styles.coreBar, styles.coreBarTwo)} />
                <i {...stylex.props(styles.coreBar, styles.coreBarThree)} />
                <i {...stylex.props(styles.coreBar, styles.coreBarFour)} />
              </div>
            </div>
            <div {...stylex.props(styles.agentCard, styles.agentOne)}>
              <span {...stylex.props(styles.agentAvatar, styles.coral)}>M</span>
              <div>
                <strong {...stylex.props(styles.agentTitle)}>Morgan</strong>
                <small {...stylex.props(styles.agentMeta)}>Reviewing dashboard</small>
              </div>
              <span {...stylex.props(styles.status, styles.working)}>working</span>
            </div>
            <div {...stylex.props(styles.agentCard, styles.agentTwo)}>
              <span {...stylex.props(styles.agentAvatar, styles.blue)}>C</span>
              <div>
                <strong {...stylex.props(styles.agentTitle)}>Codex</strong>
                <small {...stylex.props(styles.agentMeta)}>Fixing session import</small>
              </div>
              <span {...stylex.props(styles.status, styles.waiting)}>waiting</span>
            </div>
            <div {...stylex.props(styles.agentCard, styles.agentThree)}>
              <span {...stylex.props(styles.agentAvatar, styles.lime)}>J</span>
              <div>
                <strong {...stylex.props(styles.agentTitle)}>Jarvis</strong>
                <small {...stylex.props(styles.agentMeta)}>Coordinating 4 tasks</small>
              </div>
              <span {...stylex.props(styles.status, styles.working)}>working</span>
            </div>
            <div {...stylex.props(styles.signalPing, styles.pingOne)} />
            <div {...stylex.props(styles.signalPing, styles.pingTwo)} />
          </div>
        </section>

        <section {...stylex.props(styles.signalStrip)}>
          <span>12 active sessions</span>
          <i {...stylex.props(styles.stripDot)} />
          <span>5 git worktrees</span>
          <i {...stylex.props(styles.stripDot)} />
          <span>2 need attention</span>
          <i {...stylex.props(styles.stripDot)} />
          <span>All systems visible</span>
        </section>
      </main>
    </div>
  );
}
