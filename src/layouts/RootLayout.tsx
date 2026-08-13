import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, Outlet, isRouteErrorResponse, useRouteError } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { browserPlaybackStore, useBrowserPlaybackSnapshot } from "../browser-playback-store.ts";
import { ElevatorMusicProvider } from "../elevator-music.tsx";
import { QuickSearchController } from "../components/page/QuickSearchController.tsx";
import { card, hero, shell, text as textStyles } from "../styles/chrome.stylex.ts";
import { isPushKnownToServer, registerServiceWorker, subscribeToPush } from "../push.ts";
import { hasAutoplayPermission, playSendDing, warmSendDing } from "../sound.ts";

interface SoundContextValue {
  soundEnabled: boolean;
  setSoundEnabled: (soundEnabled: boolean) => void;
  showEnableSound: boolean;
  setShowEnableSound: (showEnableSound: boolean) => void;
  notifEnabled: boolean;
  setNotifEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  showEnableNotif: boolean;
  setShowEnableNotif: React.Dispatch<React.SetStateAction<boolean>>;
  enableSound: () => Promise<void>;
  enableNotifications: () => Promise<void>;
}

const SoundContext = createContext<SoundContextValue | null>(null);

export function useSoundContext() {
  const context = useContext(SoundContext);
  if (!context) throw new Error("useSoundContext must be used inside RootLayout.");
  return context;
}

export function RootErrorBoundary() {
  const error = useRouteError();
  return (
    <main {...stylex.props(shell.root)}>
      <section {...stylex.props(card.base, card.allowOverflow, hero.root)}>
        <div>
          <h1 {...stylex.props(textStyles.errorTitle)}>Something went wrong</h1>
          <p {...stylex.props(textStyles.errorBody)}>
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
          <Link to="/">Back to sessions</Link>
        </div>
      </section>
    </main>
  );
}

export function SessionErrorBoundary() {
  const error = useRouteError();
  return (
    <main {...stylex.props(shell.root)}>
      <section {...stylex.props(card.base, card.allowOverflow, hero.root)}>
        <div>
          <h1 {...stylex.props(textStyles.errorTitle)}>Something went wrong</h1>
          <p {...stylex.props(textStyles.errorBody)}>
            {isRouteErrorResponse(error)
              ? `${error.status}: ${error.statusText}`
              : error instanceof Error
                ? error.message
                : "Unknown error"}
          </p>
          <Link to="/">Back to sessions</Link>
        </div>
      </section>
    </main>
  );
}

export function RootLayout() {
  const playbackSnapshot = useBrowserPlaybackSnapshot();
  const { showEnableSound, soundEnabled } = playbackSnapshot;
  const [notifEnabled, setNotifEnabled] = useState(
    () => typeof Notification !== "undefined" && Notification.permission === "granted",
  );
  const [showEnableNotif, setShowEnableNotif] = useState(false);

  // Prompt when we can't push to this browser: no permission, or the server lost
  // this browser's (in-memory) subscription on a restart.
  const refreshNotifPrompt = useCallback(async () => {
    if (typeof Notification === "undefined" || Notification.permission === "denied") {
      setShowEnableNotif(false);
      return;
    }
    if (Notification.permission !== "granted") {
      setShowEnableNotif(true);
      return;
    }
    setShowEnableNotif(!(await isPushKnownToServer()));
  }, []);

  const refreshNotifPromptRef = useRef(refreshNotifPrompt);
  refreshNotifPromptRef.current = refreshNotifPrompt;

  useEffect(() => {
    browserPlaybackStore.setSoundEnabled(hasAutoplayPermission());
    void (async () => {
      // Register the SW so we can receive/inspect pushes, but do NOT subscribe
      // here — subscribing is an explicit user action, else the prompt never
      // appears and the user never opts in.
      await registerServiceWorker();
      void refreshNotifPromptRef.current();
    })();
  }, []);

  // The initial check runs in the mount effect after SW registration; here we
  // only re-check on focus and a slow interval so a restart surfaces the prompt.
  useEffect(() => {
    const recheck = () => void refreshNotifPrompt();
    window.addEventListener("focus", recheck);
    const timer = setInterval(recheck, 20_000);
    return () => {
      window.removeEventListener("focus", recheck);
      clearInterval(timer);
    };
  }, [refreshNotifPrompt]);

  useEffect(() => {
    if (soundEnabled) {
      browserPlaybackStore.setShowEnableSound(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      browserPlaybackStore.setShowEnableSound(!hasAutoplayPermission());
    }, 3000);
    return () => clearTimeout(timer);
  }, [soundEnabled]);

  async function enableSound() {
    const warmed = await warmSendDing();
    const played = await playSendDing({ volumeScale: 0.01 });
    if (warmed || played || hasAutoplayPermission()) {
      browserPlaybackStore.setSoundEnabled(true);
      browserPlaybackStore.setShowEnableSound(false);
    }
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") return;
    const permission =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission === "granted") {
      setNotifEnabled(true);
      await subscribeToPush();
      await refreshNotifPrompt();
    }
  }

  return (
    <SoundContext.Provider
      value={{
        soundEnabled,
        setSoundEnabled: browserPlaybackStore.setSoundEnabled,
        showEnableSound,
        setShowEnableSound: browserPlaybackStore.setShowEnableSound,
        notifEnabled,
        setNotifEnabled,
        showEnableNotif,
        setShowEnableNotif,
        enableSound,
        enableNotifications,
      }}
    >
      <ElevatorMusicProvider>
        <QuickSearchController>
          <Outlet />
        </QuickSearchController>
      </ElevatorMusicProvider>
    </SoundContext.Provider>
  );
}
