/**
 * Sounds ported from the Say To Me app (`src/sound.ts`) so T3 Code sounds the
 * same: a short rising "ding" when a message is sent, and a softer two-tone
 * chime when a session goes idle. Tones are synthesized rather than shipped as
 * assets, which keeps the fork free of binary files.
 */

const SEND_DING = {
  duration: 0.16,
  volume: 0.24,
  type: "triangle",
  startFrequency: 440,
  endFrequency: 587,
} as const;

const IDLE_COMPLETION_DING = {
  duration: 0.58,
  volume: 0.12,
  type: "sine",
  firstDuration: 0.26,
  firstFrequency: 370,
  secondDelay: 0.28,
  secondDuration: 0.3,
  secondFrequency: 554,
} as const;

const SAMPLE_RATE = 44100;
const WAV_HEADER_BYTES = 44;

export const IDLE_COMPLETION_DING_DURATION_MS = Math.round(IDLE_COMPLETION_DING.duration * 1000);

function audioContextConstructor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const extendedWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? extendedWindow.webkitAudioContext;
}

function navigatorAutoplayPolicy(): ((type: string) => string) | undefined {
  if (typeof navigator === "undefined") return undefined;
  const extendedNavigator = navigator as Navigator & {
    getAutoplayPolicy?: (type: string) => string;
  };
  return extendedNavigator.getAutoplayPolicy?.bind(navigator);
}

/**
 * Builds a mono 16-bit PCM WAV data URL. `amplitudeAt` receives the sample
 * index and its time offset in seconds, and returns amplitude in [-1, 1].
 */
function createWavUrl(
  duration: number,
  amplitudeAt: (index: number, time: number) => number,
): string {
  const samples = Math.floor(SAMPLE_RATE * duration);
  const dataBytes = samples * 2;
  const view = new DataView(new ArrayBuffer(WAV_HEADER_BYTES + dataBytes));
  let offset = 0;

  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  };
  const writeUint32 = (value: number) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const writeUint16 = (value: number) => {
    view.setUint16(offset, value, true);
    offset += 2;
  };

  writeString("RIFF");
  writeUint32(36 + dataBytes);
  writeString("WAVEfmt ");
  writeUint32(16);
  writeUint16(1);
  writeUint16(1);
  writeUint32(SAMPLE_RATE);
  writeUint32(SAMPLE_RATE * 2);
  writeUint16(2);
  writeUint16(16);
  writeString("data");
  writeUint32(dataBytes);

  for (let index = 0; index < samples; index += 1) {
    const amplitude = amplitudeAt(index, index / SAMPLE_RATE);
    view.setInt16(offset, Math.max(-1, Math.min(1, amplitude)) * 0x7fff, true);
    offset += 2;
  }

  let binary = "";
  for (const byte of new Uint8Array(view.buffer)) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export function createSendDingWavUrl(): string {
  const samples = Math.floor(SAMPLE_RATE * SEND_DING.duration);
  return createWavUrl(SEND_DING.duration, (index) => {
    const progress = index / samples;
    const envelope = Math.sin(Math.PI * progress) * (1 - progress * 0.45);
    const frequency =
      SEND_DING.startFrequency + (SEND_DING.endFrequency - SEND_DING.startFrequency) * progress;
    return Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) * envelope * SEND_DING.volume;
  });
}

export function createIdleCompletionDingWavUrl(): string {
  const firstEnd = IDLE_COMPLETION_DING.firstDuration;
  const secondStart = IDLE_COMPLETION_DING.secondDelay;
  const secondEnd = secondStart + IDLE_COMPLETION_DING.secondDuration;

  return createWavUrl(IDLE_COMPLETION_DING.duration, (index, time) => {
    const frequency =
      time < firstEnd ? IDLE_COMPLETION_DING.firstFrequency : IDLE_COMPLETION_DING.secondFrequency;
    const toneProgress =
      time < firstEnd
        ? time / IDLE_COMPLETION_DING.firstDuration
        : (time - secondStart) / IDLE_COMPLETION_DING.secondDuration;
    const envelope =
      time <= firstEnd || (time >= secondStart && time <= secondEnd)
        ? Math.sin(Math.PI * Math.max(0, Math.min(1, toneProgress)))
        : 0;
    return (
      Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE) *
      envelope *
      IDLE_COMPLETION_DING.volume
    );
  });
}

type WebAudioTone = {
  frequency: number;
  duration: number;
  start: number;
  volume: number;
  attack: number;
};

type Ding = {
  createUrl: () => string;
  oscillatorType: OscillatorType;
  /** Frequency slide applied to the first tone, used by the send ding. */
  glideTo?: { frequency: number; after: number };
  tones: (volumeScale: number) => WebAudioTone[];
};

const sendDing: Ding = {
  createUrl: createSendDingWavUrl,
  oscillatorType: SEND_DING.type,
  glideTo: { frequency: SEND_DING.endFrequency, after: 0.1 },
  tones: (volumeScale) => [
    {
      frequency: SEND_DING.startFrequency,
      duration: SEND_DING.duration,
      start: 0,
      volume: SEND_DING.volume * 0.28 * volumeScale,
      attack: 0.01,
    },
  ],
};

const idleCompletionDing: Ding = {
  createUrl: createIdleCompletionDingWavUrl,
  oscillatorType: IDLE_COMPLETION_DING.type,
  tones: (volumeScale) => [
    {
      frequency: IDLE_COMPLETION_DING.firstFrequency,
      duration: IDLE_COMPLETION_DING.firstDuration,
      start: 0,
      volume: IDLE_COMPLETION_DING.volume * volumeScale,
      attack: 0.015,
    },
    {
      frequency: IDLE_COMPLETION_DING.secondFrequency,
      duration: IDLE_COMPLETION_DING.secondDuration,
      start: IDLE_COMPLETION_DING.secondDelay,
      volume: IDLE_COMPLETION_DING.volume * 0.75 * volumeScale,
      attack: 0.015,
    },
  ],
};

const audioCache = new WeakMap<Ding, HTMLAudioElement>();
let sharedContext: AudioContext | null = null;

function prepareAudio(ding: Ding): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  const cached = audioCache.get(ding);
  if (cached) return cached;
  const audio = new Audio(ding.createUrl());
  audio.preload = "auto";
  audio.load();
  audioCache.set(ding, audio);
  return audio;
}

async function play(ding: Ding, volumeScale: number): Promise<boolean> {
  const audio = prepareAudio(ding);
  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = Math.max(0, Math.min(1, volumeScale));
      await audio.play();
      return true;
    } catch {
      // Fall through to Web Audio when element playback is blocked.
    }
  }

  const AudioContextConstructor = audioContextConstructor();
  if (!AudioContextConstructor) return false;

  try {
    if (!sharedContext || sharedContext.state === "closed") {
      sharedContext = new AudioContextConstructor();
    }
    const context = sharedContext;
    if (context.state === "suspended") await context.resume();
    const startedAt = context.currentTime;

    for (const tone of ding.tones(volumeScale)) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const toneStart = startedAt + tone.start;

      oscillator.type = ding.oscillatorType;
      oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
      if (ding.glideTo) {
        oscillator.frequency.exponentialRampToValueAtTime(
          ding.glideTo.frequency,
          toneStart + ding.glideTo.after,
        );
      }
      gain.gain.setValueAtTime(0.0001, toneStart);
      gain.gain.exponentialRampToValueAtTime(tone.volume, toneStart + tone.attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + tone.duration);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(toneStart);
      oscillator.stop(toneStart + tone.duration + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Plays the send ding. Callers should invoke this from a user gesture (the send
 * action) so autoplay policies allow it. Resolves false only when the browser
 * offers no usable audio path; blocked element playback falls back to Web Audio.
 */
export function playSendDing({ volumeScale = 1 } = {}): Promise<boolean> {
  return play(sendDing, volumeScale);
}

/**
 * Primes the browser's audio element and Web Audio context from a user
 * gesture. This does not emit an audible ding; it only unlocks later idle
 * notifications.
 */
export async function warmSendDing(): Promise<boolean> {
  const audio = prepareAudio(sendDing);
  const AudioContextConstructor = audioContextConstructor();
  if (!AudioContextConstructor) return Boolean(audio);

  try {
    if (!sharedContext || sharedContext.state === "closed") {
      sharedContext = new AudioContextConstructor();
    }
    if (sharedContext.state === "suspended") await sharedContext.resume();
    return true;
  } catch {
    return Boolean(audio);
  }
}

/** Returns whether the browser reports an autoplay permission for audio. */
export function hasAutoplayPermission(): boolean {
  const getAutoplayPolicy = navigatorAutoplayPolicy();
  if (!getAutoplayPolicy) return false;
  return ["mediaelement", "audiocontext"].some((type) => getAutoplayPolicy(type) === "allowed");
}

/**
 * Plays the softer two-tone chime used when a session goes idle. This fires
 * outside a user gesture, so it relies on audio already being unlocked — which
 * the send ding does for any session the user has typed into.
 */
export function playIdleCompletionDing({ volumeScale = 0.9 } = {}): Promise<boolean> {
  return play(idleCompletionDing, volumeScale);
}

export function resetVoiceWidgetSounds(): void {
  audioCache.delete(sendDing);
  audioCache.delete(idleCompletionDing);
  sharedContext = null;
}
