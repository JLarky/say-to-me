import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useBrowserPlaybackSnapshot } from "./browser-playback-store.ts";
import { createKeepAwake, type KeepAwakeSession } from "./keep-awake.ts";

// Source attribution: https://pixabay.com/music/bossa-nova-lounge-jazz-elevator-music-489965/
const elevatorMusicUrl = "/elevator-music.mp3";
const defaultElevatorMusicVolume = 0.3;
const duckedElevatorMusicVolume = 0.1;

type ElevatorMusicContextValue = {
  error: string;
  isPlaying: boolean;
  toggle: () => Promise<void>;
};

const ElevatorMusicContext = createContext<ElevatorMusicContextValue | null>(null);
const fallbackElevatorMusicContext: ElevatorMusicContextValue = {
  error: "",
  isPlaying: false,
  toggle: async () => {},
};

export function ElevatorMusicProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const keepAwakeRef = useRef<KeepAwakeSession | null>(null);
  const browserPlayback = useBrowserPlaybackSnapshot();
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState("");
  const currentVolume = browserPlayback.messageId
    ? duckedElevatorMusicVolume
    : defaultElevatorMusicVolume;

  useEffect(() => {
    return () => stopElevatorMusic();
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = currentVolume;
  }, [currentVolume]);

  async function toggle() {
    const existingAudio = audioRef.current;
    if (existingAudio) {
      if (isPlaying) {
        endKeepAwake();
        existingAudio.pause();
        setIsPlaying(false);
        return;
      }
      try {
        existingAudio.volume = currentVolume;
        void beginKeepAwake();
        await existingAudio.play();
        setError("");
        setIsPlaying(true);
      } catch (caught) {
        endKeepAwake();
        setError(caught instanceof Error ? caught.message : String(caught));
      }
      return;
    }

    try {
      const audio = new Audio(elevatorMusicUrl);
      audio.loop = true;
      audio.volume = currentVolume;
      audioRef.current = audio;
      void beginKeepAwake();
      await audio.play();
      setError("");
      setIsPlaying(true);
    } catch (caught) {
      stopElevatorMusic();
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function beginKeepAwake() {
    keepAwakeRef.current?.stop();
    const keepAwake = createKeepAwake();
    keepAwakeRef.current = keepAwake;
    await keepAwake.start();
  }

  function endKeepAwake() {
    keepAwakeRef.current?.stop();
    keepAwakeRef.current = null;
  }

  function stopElevatorMusic() {
    endKeepAwake();
    const audio = audioRef.current;
    audioRef.current = null;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPlaying(false);
  }

  return (
    <ElevatorMusicContext.Provider value={{ error, isPlaying, toggle }}>
      {children}
    </ElevatorMusicContext.Provider>
  );
}

export function useElevatorMusic() {
  const context = useContext(ElevatorMusicContext);
  return context ?? fallbackElevatorMusicContext;
}
