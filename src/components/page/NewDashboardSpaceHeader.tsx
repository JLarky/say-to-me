import * as stylex from "@stylexjs/stylex";

import type { PrototypeSpace } from "../../new-space-prototype.ts";
import type { SpaceMenuContentProps } from "./NewDashboardChrome.tsx";
import { Icon, shortcutLabel, SpaceActionsTrigger } from "./NewDashboardChrome.tsx";
import { useOptionalQuickSearch } from "./QuickSearchController.tsx";
import { spaceHeader } from "./NewDashboardSpaceHeader.stylex.ts";

interface DashboardSpaceHeaderProps extends Omit<SpaceMenuContentProps, "title"> {
  space: PrototypeSpace;
  parentName: string;
  parentSpaceId?: string;
  repoName: string;
  worktreeName: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpenNavigator: () => void;
  onOpenGitPicker: () => void;
  onSelectSpace: (spaceId: string) => void;
}

function QuickSearchTrigger({ compact = false }: { compact?: boolean }) {
  const quickSearch = useOptionalQuickSearch();
  const label = shortcutLabel();
  return (
    <button
      {...stylex.props(compact ? spaceHeader.compactSearchButton : spaceHeader.searchButton)}
      type="button"
      aria-label="Quick search"
      data-quick-search-trigger
      onClick={(event) => quickSearch?.openQuickSearch(event.currentTarget)}
    >
      <Icon name="search" />{" "}
      <span {...stylex.props(compact && spaceHeader.compactSearchLabel)}>Search </span>
      <kbd
        {...stylex.props(spaceHeader.searchShortcut, compact && spaceHeader.compactSearchLabel)}
        aria-hidden="true"
      >
        {label}
      </kbd>
    </button>
  );
}

export function DashboardSpaceHeader(props: DashboardSpaceHeaderProps) {
  const { space, parentName, repoName, worktreeName } = props;
  return (
    <header {...stylex.props(spaceHeader.root)}>
      <div {...stylex.props(spaceHeader.commandBar)}>
        <nav {...stylex.props(spaceHeader.breadcrumb)} aria-label="Space breadcrumb">
          <button
            {...stylex.props(spaceHeader.breadcrumbButton)}
            type="button"
            onClick={props.onOpenNavigator}
          >
            Spaces
          </button>
          <span {...stylex.props(spaceHeader.breadcrumbSeparator)}>/</span>
          {parentName !== "Top level" ? (
            <>
              <button
                {...stylex.props(spaceHeader.breadcrumbButton)}
                type="button"
                onClick={() => props.parentSpaceId && props.onSelectSpace(props.parentSpaceId)}
              >
                {parentName}
              </button>
              <span {...stylex.props(spaceHeader.breadcrumbSeparator)}>/</span>
            </>
          ) : null}
          <strong {...stylex.props(spaceHeader.breadcrumbCurrent)}>{space.name}</strong>
        </nav>
        <div {...stylex.props(spaceHeader.commandActions)}>
          <QuickSearchTrigger compact />
          <button
            {...stylex.props(spaceHeader.switchButton)}
            type="button"
            onClick={props.onOpenNavigator}
          >
            <Icon name="folder" /> Switch
            <span {...stylex.props(spaceHeader.switchLabelExtra)}> space</span>
          </button>
        </div>
      </div>

      <div {...stylex.props(spaceHeader.body)}>
        <div {...stylex.props(spaceHeader.identityRow)}>
          <div {...stylex.props(spaceHeader.identity)}>
            <h1 {...stylex.props(spaceHeader.title)}>{space.name}</h1>
            <p {...stylex.props(spaceHeader.description)}>{space.context}</p>
          </div>
          <div {...stylex.props(spaceHeader.desktopActions)}>
            <QuickSearchTrigger />
          </div>
          <div {...stylex.props(spaceHeader.mobileActions)}>
            <SpaceActionsTrigger
              title={space.name}
              open={props.menuOpen}
              compact
              onToggle={props.onToggleMenu}
              onCreateJarvis={props.onCreateJarvis}
              createJarvisDisabled={props.createJarvisDisabled}
              onOrganize={props.onOrganize}
              onEdit={props.onEdit}
              onMove={props.onMove}
              onArchive={props.onArchive}
              onDelete={props.onDelete}
            />
          </div>
        </div>
        <button
          {...stylex.props(spaceHeader.gitContextChip)}
          type="button"
          aria-label="Switch repository or worktree"
          onClick={props.onOpenGitPicker}
        >
          <span {...stylex.props(spaceHeader.gitContextIcon)}>
            <Icon name="branch" />
          </span>
          <span {...stylex.props(spaceHeader.gitContextCopy)}>
            <small {...stylex.props(spaceHeader.gitContextLabel)}>GIT CONTEXT</small>
            <strong {...stylex.props(spaceHeader.gitContextValue)}>{repoName}</strong>
          </span>
          <span {...stylex.props(spaceHeader.gitContextMeta)}>{worktreeName}</span>
          <Icon name="chevron" />
        </button>
      </div>
    </header>
  );
}
