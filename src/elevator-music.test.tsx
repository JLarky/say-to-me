/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ElevatorMusicProvider, useElevatorMusic } from "./elevator-music.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

class FakeAudio {
  loop = false;
  volume = 1;
  currentTime = 0;
  play = vi.fn(async () => {});
  pause = vi.fn(() => {});
}

function Probe() {
  const elevatorMusic = useElevatorMusic();
  return (
    <button type="button" onClick={() => void elevatorMusic.toggle()}>
      {elevatorMusic.isPlaying ? "Pause elevator music" : "Play elevator music"}
    </button>
  );
}

describe("ElevatorMusicProvider keep-awake", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    container = undefined;
    root = undefined;
  });

  it("requests a screen wake lock when music plays and releases it on pause", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const sentinel = {
      release: vi.fn(async () => {}),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const request = vi.fn(async () => sentinel);
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ElevatorMusicProvider>
          <Probe />
        </ElevatorMusicProvider>,
      );
    });

    const button = container.querySelector("button")!;
    await act(async () => {
      button.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(button.textContent).toBe("Pause elevator music");
    expect(request).toHaveBeenCalledWith("screen");
    expect(document.querySelector("video")).toBeNull();

    await act(async () => {
      button.click();
    });

    expect(button.textContent).toBe("Play elevator music");
    expect(sentinel.release).toHaveBeenCalled();
  });
});
