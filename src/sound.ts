const sendDing = {
  duration: 0.16,
  volume: 0.24,
  type: "triangle",
  startFrequency: 440,
  endFrequency: 587,
};

const idleCompletionDing = {
  duration: 0.58,
  volume: 0.12,
  type: "sine",
  firstDuration: 0.26,
  firstFrequency: 370,
  secondDelay: 0.28,
  secondDuration: 0.3,
  secondFrequency: 554,
};

let sendDingContext: AudioContext | null = null;

function audioContextConstructor() {
  const extendedWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? extendedWindow.webkitAudioContext;
}

function navigatorAutoplayPolicy() {
  const extendedNavigator = navigator as Navigator & {
    getAutoplayPolicy?: (type: string) => string;
  };
  return extendedNavigator.getAutoplayPolicy?.bind(navigator);
}
let sendDingAudio: HTMLAudioElement | null = null;
let sendDingUrl: string | null = null;
let idleCompletionAudio: HTMLAudioElement | null = null;
let idleCompletionUrl: string | null = null;

export async function stopAllSounds() {
  for (const audio of [sendDingAudio, idleCompletionAudio]) {
    if (!audio) continue;
    audio.pause();
    audio.currentTime = 0;
  }

  if (!sendDingContext || sendDingContext.state === "closed") return;
  const context = sendDingContext;
  sendDingContext = null;
  await context.close().catch(() => {});
}

function createSendDingUrl() {
  const sampleRate = 44100;
  const duration = sendDing.duration;
  const samples = Math.floor(sampleRate * duration);
  const headerBytes = 44;
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(buffer);
  let offset = 0;

  function writeString(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  }

  writeString("RIFF");
  view.setUint32(offset, 36 + dataBytes, true);
  offset += 4;
  writeString("WAVEfmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * 2, true);
  offset += 4;
  view.setUint16(offset, 2, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString("data");
  view.setUint32(offset, dataBytes, true);
  offset += 4;

  for (let index = 0; index < samples; index += 1) {
    const progress = index / samples;
    const envelope = Math.sin(Math.PI * progress) * (1 - progress * 0.45);
    const frequency =
      sendDing.startFrequency + (sendDing.endFrequency - sendDing.startFrequency) * progress;
    const sample =
      Math.sin((2 * Math.PI * frequency * index) / sampleRate) * envelope * sendDing.volume;
    view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
    offset += 2;
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function createIdleCompletionDingUrl() {
  const sampleRate = 44100;
  const duration = idleCompletionDing.duration;
  const samples = Math.floor(sampleRate * duration);
  const headerBytes = 44;
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(headerBytes + dataBytes);
  const view = new DataView(buffer);
  let offset = 0;

  function writeString(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  }

  writeString("RIFF");
  view.setUint32(offset, 36 + dataBytes, true);
  offset += 4;
  writeString("WAVEfmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * 2, true);
  offset += 4;
  view.setUint16(offset, 2, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString("data");
  view.setUint32(offset, dataBytes, true);
  offset += 4;

  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const firstEnd = idleCompletionDing.firstDuration;
    const secondStart = idleCompletionDing.secondDelay;
    const secondEnd = secondStart + idleCompletionDing.secondDuration;
    const frequency =
      time < firstEnd ? idleCompletionDing.firstFrequency : idleCompletionDing.secondFrequency;
    const toneProgress =
      time < firstEnd
        ? time / idleCompletionDing.firstDuration
        : (time - secondStart) / idleCompletionDing.secondDuration;
    const envelope =
      time <= firstEnd || (time >= secondStart && time <= secondEnd)
        ? Math.sin(Math.PI * Math.max(0, Math.min(1, toneProgress)))
        : 0;
    const sample =
      Math.sin((2 * Math.PI * frequency * index) / sampleRate) *
      envelope *
      idleCompletionDing.volume;
    view.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
    offset += 2;
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function prepareSendDingAudio() {
  if (typeof Audio === "undefined") return null;
  if (!sendDingUrl) sendDingUrl = createSendDingUrl();
  if (!sendDingAudio) {
    sendDingAudio = new Audio(sendDingUrl);
    sendDingAudio.preload = "auto";
    sendDingAudio.volume = 1;
    sendDingAudio.load();
  }
  return sendDingAudio;
}

function prepareIdleCompletionAudio() {
  if (typeof Audio === "undefined") return null;
  if (!idleCompletionUrl) idleCompletionUrl = createIdleCompletionDingUrl();
  if (!idleCompletionAudio) {
    idleCompletionAudio = new Audio(idleCompletionUrl);
    idleCompletionAudio.preload = "auto";
    idleCompletionAudio.volume = 1;
    idleCompletionAudio.load();
  }
  return idleCompletionAudio;
}

export async function playSendDing({ volumeScale = 1 } = {}) {
  const audio = prepareSendDingAudio();
  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = volumeScale;
      await audio.play();
      return true;
    } catch {
      // Fall through to Web Audio when the element path is blocked.
    }
  }

  const AudioContext = audioContextConstructor();
  if (!AudioContext) return false;

  if (!sendDingContext || sendDingContext.state === "closed") {
    sendDingContext = new AudioContext();
  }

  const context = sendDingContext;
  if (context.state === "suspended") await context.resume();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startedAt = context.currentTime;

  oscillator.type = sendDing.type as OscillatorType;
  oscillator.frequency.setValueAtTime(sendDing.startFrequency, startedAt);
  oscillator.frequency.exponentialRampToValueAtTime(sendDing.endFrequency, startedAt + 0.1);
  gain.gain.setValueAtTime(0.0001, startedAt);
  gain.gain.exponentialRampToValueAtTime(sendDing.volume * 0.28 * volumeScale, startedAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + sendDing.duration);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startedAt);
  oscillator.stop(startedAt + sendDing.duration + 0.02);
  return true;
}

export async function playIdleCompletionDing({ volumeScale = 1 } = {}) {
  const audio = prepareIdleCompletionAudio();
  if (audio) {
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = volumeScale;
      await audio.play();
      return true;
    } catch {
      // Fall through to Web Audio when the element path is blocked.
    }
  }

  const AudioContext = audioContextConstructor();
  if (!AudioContext) return false;

  if (!sendDingContext || sendDingContext.state === "closed") {
    sendDingContext = new AudioContext();
  }

  const context = sendDingContext;
  if (context.state === "suspended") await context.resume();
  const startedAt = context.currentTime;
  const tones = [
    {
      duration: idleCompletionDing.firstDuration,
      frequency: idleCompletionDing.firstFrequency,
      start: 0,
      volume: idleCompletionDing.volume,
    },
    {
      duration: idleCompletionDing.secondDuration,
      frequency: idleCompletionDing.secondFrequency,
      start: idleCompletionDing.secondDelay,
      volume: idleCompletionDing.volume * 0.75,
    },
  ];
  for (const tone of tones) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const toneStart = startedAt + tone.start;
    oscillator.type = idleCompletionDing.type as OscillatorType;
    oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
    gain.gain.setValueAtTime(0.0001, toneStart);
    gain.gain.exponentialRampToValueAtTime(tone.volume * volumeScale, toneStart + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + tone.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(toneStart);
    oscillator.stop(toneStart + tone.duration + 0.02);
  }
  return true;
}

export async function warmSendDing() {
  const audio = prepareSendDingAudio();

  const AudioContext = audioContextConstructor();
  if (!AudioContext) return Boolean(audio);

  if (!sendDingContext || sendDingContext.state === "closed") {
    sendDingContext = new AudioContext();
  }
  if (sendDingContext.state === "suspended") await sendDingContext.resume();
  return true;
}

export function hasAutoplayPermission() {
  const getAutoplayPolicy = navigatorAutoplayPolicy();
  if (!getAutoplayPolicy) return false;
  return ["mediaelement", "audiocontext"].some((type) => getAutoplayPolicy(type) === "allowed");
}
