import { type ReactNode } from "react";
import * as stylex from "@stylexjs/stylex";

import { chrome } from "./NewDashboardChrome.stylex.ts";

export type IconName =
  | "home"
  | "grid"
  | "bell"
  | "plus"
  | "search"
  | "branch"
  | "chevron"
  | "more"
  | "folder"
  | "session"
  | "repo";

export function Icon({ name }: { name: IconName }) {
  const paths = {
    home: (
      <>
        <path d="M3 10.5 10 4l7 6.5" />
        <path d="M5.5 9.5V17h9V9.5" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="5" height="5" rx="1" />
        <rect x="12" y="3" width="5" height="5" rx="1" />
        <rect x="3" y="12" width="5" height="5" rx="1" />
        <rect x="12" y="12" width="5" height="5" rx="1" />
      </>
    ),
    bell: (
      <>
        <path d="M5 8a5 5 0 0 1 10 0c0 5 2 5 2 6H3c0-1 2-1 2-6Z" />
        <path d="M8 17h4" />
      </>
    ),
    plus: <path d="M10 4v12M4 10h12" />,
    search: (
      <>
        <circle cx="9" cy="9" r="5" />
        <path d="m13 13 4 4" />
      </>
    ),
    branch: (
      <>
        <circle cx="6" cy="5" r="2" />
        <circle cx="14" cy="15" r="2" />
        <path d="M6 7v3c0 3 2 5 6 5M6 10h4c3 0 4-2 4-4V5" />
      </>
    ),
    chevron: <path d="m8 5 5 5-5 5" />,
    more: (
      <>
        <circle cx="4" cy="10" r="1" fill="currentColor" />
        <circle cx="10" cy="10" r="1" fill="currentColor" />
        <circle cx="16" cy="10" r="1" fill="currentColor" />
      </>
    ),
    folder: <path d="M3 6h5l2 2h7v8H3Z" />,
    session: <path d="M4 5h12v9H9l-4 3v-3H4Z" />,
    repo: (
      <>
        <path d="M5 3h9a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2Z" />
        <path d="M7 3v14" />
      </>
    ),
  } satisfies Record<IconName, ReactNode>;

  return (
    <svg {...stylex.props(chrome.icon)} viewBox="0 0 20 20" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** True when the UI should advertise ⌘K (Apple platforms). */
export function isApplePlatform(
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

export function usesMetaQuickSearchShortcut(
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
): boolean {
  return isApplePlatform(platform);
}

export function shortcutLabel(
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
): string {
  return usesMetaQuickSearchShortcut(platform) ? "⌘K" : "Ctrl+K";
}

/** Whether this keydown is the platform-advertised quick-search chord. */
export function isQuickSearchShortcutEvent(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
): boolean {
  if (event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== "k") return false;
  const preferMeta = usesMetaQuickSearchShortcut(platform);
  if (preferMeta) return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
}
