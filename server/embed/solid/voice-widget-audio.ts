/** Serializes STM speech and bounds hung browser utterances. */
let tail: Promise<unknown> = Promise.resolve();
async function runBounded(play: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      play(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // A failed utterance must not wedge subsequent speech.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
export function enqueueVoiceAudio(play: () => Promise<void>, timeoutMs: number): Promise<void> {
  const run = () => runBounded(play, timeoutMs);
  const next = tail.then(run, run);
  tail = next;
  return next;
}
export function resetVoiceAudioQueue(): void {
  tail = Promise.resolve();
}
export function isVoiceSpeechActive(): boolean {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Environment guard: detects whether a browser `window` global exists (SSR/Node safety).
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  return window.speechSynthesis.speaking || window.speechSynthesis.pending;
}
