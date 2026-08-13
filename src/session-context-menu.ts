/** True when the right-click landed on a session href (browser menu territory). */
export function isSessionLinkContextTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("[data-session-link]"));
}

/** Close the Spaces session context menu unless the event landed on the menu or a session row body. */
export function shouldDismissSessionContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("[data-session-context-menu]")) return false;
  // Anchor right-clicks are browser-menu-only — dismiss any open custom menu.
  if (isSessionLinkContextTarget(target)) return true;
  if (target.closest("[data-session-item]")) return false;
  return true;
}

export function sessionHref(sessionId: string): string {
  return `/ses/${encodeURIComponent(sessionId)}`;
}

/** True for an unmodified primary (left) click that should use SPA navigation. */
export function isUnmodifiedPrimaryClick(event: {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}
