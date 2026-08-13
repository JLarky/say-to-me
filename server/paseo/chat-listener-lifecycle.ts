let startListener: (sessionId: string) => void = () => {};
let stopListener: (sessionId: string) => void = () => {};

export function registerPaseoChatListenerStarter(start: (sessionId: string) => void): void {
  startListener = start;
}

export function registerPaseoChatListenerStopper(stop: (sessionId: string) => void): void {
  stopListener = stop;
}

export function stopPaseoChatListener(sessionId: string): void {
  stopListener(sessionId);
}

export function startPaseoChatListener(sessionId: string): void {
  startListener(sessionId);
}
