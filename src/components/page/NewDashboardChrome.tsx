import { type ReactNode, useRef } from "react";
import * as stylex from "@stylexjs/stylex";
import { Link } from "react-router";

import { useOptionalQuickSearch } from "./QuickSearchController.tsx";
import { Icon, shortcutLabel } from "./chrome-icons.tsx";
import { chrome, menu } from "./NewDashboardChrome.stylex.ts";
import { ScopedNotificationBell } from "./ScopedNotificationBell.tsx";
import type { AppNotification } from "../../types.ts";

export { Icon, shortcutLabel, type IconName } from "./chrome-icons.tsx";
export {
  isApplePlatform,
  isQuickSearchShortcutEvent,
  usesMetaQuickSearchShortcut,
} from "./chrome-icons.tsx";

export type DashboardNotificationChromeProps = {
  spaceId?: string | null;
  spaceName?: string | null;
  spaceSessionIds?: readonly string[];
  workingCount?: number;
  notifications?: AppNotification[];
  notificationsLoaded?: boolean;
  notificationsError?: string;
  onDismissNotification?: (notificationId: number) => Promise<void> | void;
};
function AppMark() {
  return (
    <Link {...stylex.props(chrome.mark)} to="/new" aria-label="Say To Me home">
      <svg {...stylex.props(chrome.markIcon)} viewBox="0 0 28 28" aria-hidden="true">
        <path d="M7 15.5a7 7 0 1 1 14 0" />
        <path d="M10.5 15.5a3.5 3.5 0 1 1 7 0" />
        <path d="M14 15.5v7" />
      </svg>
    </Link>
  );
}

export function Sidebar({
  active,
  initials = "YL",
  notifications,
}: {
  active: string;
  initials?: string;
  notifications?: DashboardNotificationChromeProps;
}) {
  return (
    <aside {...stylex.props(chrome.sidebar)}>
      <AppMark />
      <nav {...stylex.props(chrome.sidebarNav)} aria-label="App">
        <button
          {...stylex.props(chrome.navButton, active === "home" && chrome.navButtonActive)}
          type="button"
          aria-label="Home"
        >
          {active === "home" ? <span {...stylex.props(chrome.navActiveIndicator)} /> : null}
          <Icon name="home" />
        </button>
        <Link
          {...stylex.props(chrome.navButton, active === "spaces" && chrome.navButtonActive)}
          to="/dashboard"
          aria-label="Spaces"
          aria-current={active === "spaces" ? "page" : undefined}
        >
          {active === "spaces" ? <span {...stylex.props(chrome.navActiveIndicator)} /> : null}
          <Icon name="grid" />
        </Link>
        <Link
          {...stylex.props(chrome.navButton, active === "search" && chrome.navButtonActive)}
          to="/search"
          aria-label="Search"
          aria-current={active === "search" ? "page" : undefined}
        >
          {active === "search" ? <span {...stylex.props(chrome.navActiveIndicator)} /> : null}
          <Icon name="search" />
        </Link>
        <ScopedNotificationBell
          placement="sidebar"
          spaceId={notifications?.spaceId}
          spaceName={notifications?.spaceName}
          spaceSessionIds={notifications?.spaceSessionIds}
          workingCount={notifications?.workingCount}
          notifications={notifications?.notifications}
          notificationsLoaded={notifications?.notificationsLoaded}
          notificationsError={notifications?.notificationsError}
          onDismiss={notifications?.onDismissNotification}
        />
      </nav>
      <Link
        {...stylex.props(chrome.user, active === "settings" && chrome.userActive)}
        to="/settings"
        title="Profile settings"
        aria-label="Profile settings"
      >
        {initials}
      </Link>
    </aside>
  );
}

export function Avatar({ children, tone = "lime" }: { children: ReactNode; tone?: string }) {
  const toneStyle =
    tone === "coral"
      ? chrome.coral
      : tone === "blue"
        ? chrome.blue
        : tone === "purple"
          ? chrome.purple
          : chrome.lime;
  return <span {...stylex.props(chrome.avatar, toneStyle)}>{children}</span>;
}

export function Status({ children, tone = "working" }: { children: ReactNode; tone?: string }) {
  return (
    <span
      {...stylex.props(
        chrome.status,
        tone === "attention" && chrome.statusAttention,
        tone === "waiting" && chrome.statusWaiting,
      )}
    >
      <i {...stylex.props(chrome.statusDot)} />
      {children}
    </span>
  );
}

export interface SpaceMenuContentProps {
  title: string;
  onCreateJarvis?: (opener?: HTMLElement | null) => void;
  createJarvisDisabled?: boolean;
  onOrganize?: () => void;
  onEdit?: () => void;
  onMove?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}

export function SpaceMenuContent({
  title,
  onCreateJarvis,
  createJarvisDisabled = false,
  onOrganize,
  onEdit,
  onMove,
  onArchive,
  onDelete,
}: SpaceMenuContentProps) {
  const actions = [
    [
      "plus",
      "Create Jarvis",
      createJarvisDisabled
        ? "Select or create a space first"
        : "Scaffold a Jarvis repo and session",
      createJarvisDisabled || !onCreateJarvis ? undefined : () => onCreateJarvis(),
    ],
    ["plus", "Duplicate space", "not implemented", undefined],
    ["grid", "Organize", "Drag or move spaces to reorder", onOrganize],
    ["grid", "Edit settings", "Name and description", onEdit],
    ["folder", "Move space", "Choose a new parent or top level", onMove],
    ["folder", "Archive space", "Hide from active navigation", onArchive],
  ] as const;

  return (
    <>
      <div {...stylex.props(menu.heading)}>
        <small {...stylex.props(menu.headingLabel)}>CURRENT SPACE</small>
        <strong {...stylex.props(menu.headingTitle)}>{title}</strong>
      </div>
      {actions.map(([icon, label, detail, onClick]) => {
        const disabled = !onClick;
        return (
          <button
            {...stylex.props(menu.item, disabled && menu.itemDisabled)}
            type="button"
            role="menuitem"
            disabled={disabled}
            aria-disabled={disabled || undefined}
            onClick={onClick}
            key={label}
          >
            <span {...stylex.props(menu.itemIcon)}>
              <Icon name={icon} />
            </span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>{label}</strong>
              <small {...stylex.props(menu.itemDetail)}>{detail}</small>
            </span>
          </button>
        );
      })}
      <button
        {...stylex.props(menu.item, menu.danger)}
        type="button"
        role="menuitem"
        onClick={onDelete}
      >
        <span {...stylex.props(menu.dangerIcon)}>×</span>
        <span {...stylex.props(menu.itemText)}>
          <strong {...stylex.props(menu.itemTitle)}>Delete space</strong>
          <small {...stylex.props(menu.itemDetail)}>Remove this space permanently</small>
        </span>
      </button>
    </>
  );
}

export function SpaceActionsTrigger({
  title,
  open,
  compact = false,
  onToggle,
  onCreateJarvis,
  ...actions
}: SpaceMenuContentProps & { open: boolean; compact?: boolean; onToggle: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div {...stylex.props(menu.wrap)} data-space-menu>
      <button
        {...stylex.props(menu.trigger, compact && menu.triggerCompact, open && menu.triggerOpen)}
        ref={triggerRef}
        type="button"
        aria-label="Space actions"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon name="more" />
      </button>
      {open ? (
        <div {...stylex.props(menu.popup)} role="menu">
          <SpaceMenuContent
            title={title}
            onCreateJarvis={onCreateJarvis ? () => onCreateJarvis(triggerRef.current) : undefined}
            {...actions}
          />
        </div>
      ) : null}
    </div>
  );
}

export function Topbar({
  title,
  crumb,
  notifications,
}: {
  title: string;
  crumb?: string;
  notifications?: DashboardNotificationChromeProps;
}) {
  const quickSearch = useOptionalQuickSearch();
  const label = shortcutLabel();
  return (
    <header {...stylex.props(chrome.topbar)}>
      <div>
        <small {...stylex.props(chrome.topbarLabel)}>{crumb ?? "YOUR WORKSPACE"}</small>
        <strong {...stylex.props(chrome.topbarTitle)}>{title}</strong>
      </div>
      <div {...stylex.props(chrome.topActions)}>
        <button
          {...stylex.props(chrome.searchButton)}
          type="button"
          aria-label="Quick search"
          data-quick-search-trigger
          onClick={(event) => quickSearch?.openQuickSearch(event.currentTarget)}
        >
          <Icon name="search" /> Search{" "}
          <kbd {...stylex.props(chrome.searchShortcut)} aria-hidden="true">
            {label}
          </kbd>
        </button>
        <ScopedNotificationBell
          placement="topbar"
          spaceId={notifications?.spaceId}
          spaceName={notifications?.spaceName}
          spaceSessionIds={notifications?.spaceSessionIds}
          workingCount={notifications?.workingCount}
          notifications={notifications?.notifications}
          notificationsLoaded={notifications?.notificationsLoaded}
          notificationsError={notifications?.notificationsError}
          onDismiss={notifications?.onDismissNotification}
        />
      </div>
    </header>
  );
}
