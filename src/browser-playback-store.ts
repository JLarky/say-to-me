import { useSyncExternalStore } from "react";
import { stopAllSounds } from "./sound.ts";

type PlaybackSnapshot = {
  messageId: number | null;
  showEnableSound: boolean;
  sessionId: string | null;
  soundEnabled: boolean;
  token: number | null;
};

type PlaybackJob = {
  cancel?: () => void;
  messageId: number;
  sessionId: string | null;
  token: number;
};

type BrowserPlaybackStore = {
  begin: (input: { messageId: number; sessionId: string | null }) => number;
  cancelActive: () => PlaybackJob | null;
  finish: (token: number) => void;
  getSnapshot: () => PlaybackSnapshot;
  isActive: (token: number, messageId?: number) => boolean;
  setCancel: (token: number, cancel: () => void) => void;
  setShowEnableSound: (showEnableSound: boolean) => void;
  setSoundEnabled: (soundEnabled: boolean) => void;
  stopAll: () => Promise<PlaybackJob | null>;
  subscribe: (listener: () => void) => () => void;
};

type ActivePlaybackSnapshot = Pick<PlaybackSnapshot, "messageId" | "sessionId" | "token">;

const idleSnapshot: ActivePlaybackSnapshot = {
  messageId: null,
  sessionId: null,
  token: null,
};

// SAFETY: __sayToMeBrowserPlaybackStore is only ever read and written by this
// module, immediately below, so the augmented shape is self-controlled.
const globalWithPlaybackStore = globalThis as typeof globalThis & {
  __sayToMeBrowserPlaybackStore?: BrowserPlaybackStore;
};

export const browserPlaybackStore =
  globalWithPlaybackStore.__sayToMeBrowserPlaybackStore ?? createBrowserPlaybackStore();

globalWithPlaybackStore.__sayToMeBrowserPlaybackStore = browserPlaybackStore;

export function useBrowserPlaybackSnapshot() {
  return useSyncExternalStore(
    browserPlaybackStore.subscribe,
    browserPlaybackStore.getSnapshot,
    browserPlaybackStore.getSnapshot,
  );
}

function createBrowserPlaybackStore(): BrowserPlaybackStore {
  let activeJob: PlaybackJob | null = null;
  let snapshot: PlaybackSnapshot = {
    ...idleSnapshot,
    showEnableSound: false,
    soundEnabled: false,
  };
  let tokenCounter = 0;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const setSnapshot = (nextSnapshot: PlaybackSnapshot) => {
    snapshot = nextSnapshot;
    emit();
  };

  const setActiveSnapshot = (nextActiveSnapshot: ActivePlaybackSnapshot) => {
    setSnapshot({
      ...snapshot,
      ...nextActiveSnapshot,
    });
  };

  return {
    begin({ messageId, sessionId }) {
      activeJob?.cancel?.();
      const token = ++tokenCounter;
      activeJob = { messageId, sessionId, token };
      setActiveSnapshot({ messageId, sessionId, token });
      return token;
    },
    cancelActive() {
      const job = activeJob;
      activeJob = null;
      setActiveSnapshot(idleSnapshot);
      job?.cancel?.();
      return job;
    },
    finish(token) {
      if (activeJob?.token !== token) return;
      activeJob = null;
      setActiveSnapshot(idleSnapshot);
    },
    getSnapshot() {
      return snapshot;
    },
    isActive(token, messageId) {
      return activeJob?.token === token && (messageId == null || activeJob.messageId === messageId);
    },
    setCancel(token, cancel) {
      if (activeJob?.token !== token) return;
      activeJob.cancel = cancel;
    },
    setShowEnableSound(showEnableSound) {
      if (snapshot.showEnableSound === showEnableSound) return;
      setSnapshot({ ...snapshot, showEnableSound });
    },
    setSoundEnabled(soundEnabled) {
      if (snapshot.soundEnabled === soundEnabled) return;
      setSnapshot({
        ...snapshot,
        showEnableSound: soundEnabled ? false : snapshot.showEnableSound,
        soundEnabled,
      });
    },
    async stopAll() {
      const job = this.cancelActive();
      if ("speechSynthesis" in globalThis) globalThis.speechSynthesis.cancel();
      await stopAllSounds();
      return job;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
