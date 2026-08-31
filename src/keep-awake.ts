export type KeepAwakeSession = {
  start: () => Promise<void>;
  stop: () => void;
};

type KeepAwakeSentinel = {
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
  removeEventListener: (type: "release", listener: () => void) => void;
};

export type KeepAwakeOptions = {
  document?: Document;
  requestWakeLock?: () => Promise<KeepAwakeSentinel | null>;
};

export function createKeepAwake(options: KeepAwakeOptions = {}): KeepAwakeSession {
  const doc = options.document ?? document;
  const requestWakeLock = options.requestWakeLock ?? requestScreenWakeLock;
  let stopped = false;
  let sentinel: KeepAwakeSentinel | null = null;

  async function acquireWakeLock() {
    if (stopped || doc.visibilityState !== "visible") return;
    try {
      sentinel = await requestWakeLock();
    } catch {
      sentinel = null;
      return;
    }
    sentinel?.addEventListener("release", onSentinelRelease);
  }

  function onSentinelRelease() {
    sentinel = null;
    if (stopped || doc.visibilityState !== "visible") return;
    void acquireWakeLock();
  }

  function onVisibilityChange() {
    if (stopped || doc.visibilityState !== "visible") return;
    void acquireWakeLock();
  }

  function releaseWakeLock() {
    if (!sentinel) return;
    sentinel.removeEventListener("release", onSentinelRelease);
    void sentinel.release().catch(() => {});
    sentinel = null;
  }

  async function start() {
    if (stopped) return;
    doc.addEventListener("visibilitychange", onVisibilityChange);
    await acquireWakeLock();
    if (stopped) releaseWakeLock();
  }

  function stop() {
    stopped = true;
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    releaseWakeLock();
  }

  return { start, stop };
}

async function requestScreenWakeLock(): Promise<KeepAwakeSentinel | null> {
  const wakeLock = navigator.wakeLock;
  if (!wakeLock) return null;
  try {
    return await wakeLock.request("screen");
  } catch {
    return null;
  }
}
