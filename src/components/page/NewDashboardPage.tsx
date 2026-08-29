import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import * as stylex from "@stylexjs/stylex";
import { useNavigate, useParams, useSearchParams } from "react-router";

import {
  archivePrototypeSession,
  loadPrototypeProfile,
  profileInitials,
  setPrototypeSessionState,
  sortPrototypeRosterSessions,
  flattenSpacesDepthFirst,
  sortSpacesBySortOrder,
  type PrototypeRepo,
  type PrototypeSpace,
  type PrototypeSession,
  type PrototypeSpacesState,
} from "../../new-space-prototype.ts";
import {
  applySiblingOrderOptimistic,
  spacesAfterReorderAttempt,
} from "../../space-organize-reorder.ts";
import {
  archiveSession,
  archiveSpace,
  attachRepositoryToSpace,
  claimWorktree,
  claimSession,
  createSpace,
  createWorktree,
  deleteSession,
  deleteSpace,
  discoverWorktrees,
  fetchSpaceState,
  moveSpace,
  moveSession,
  releaseRepository,
  releaseAllWorktrees,
  releaseSession,
  releaseWorktree,
  reorderSpaceSiblings,
  restoreSpace,
  setSessionState,
  updateRepository,
  updateSpace,
} from "../../spaces-api.ts";
import {
  DEFAULT_WORKTREE_PARENT_PATH,
  displayLocationPath,
  fetchSettings,
} from "../../settings-api.ts";
import {
  createProviderSession,
  fetchProviderModels,
  providerLabels,
  type CreateProvider,
  type ProviderModel,
} from "../../session-creation-api.ts";
import { importSessionById } from "../../session-import-api.ts";
import { detectPrefixedSessionBackend } from "../../session-id-patterns.ts";
import { CreateJarvisDialog } from "../CreateJarvisDialog.tsx";
import { CreateAgentWorktreeDialog } from "../CreateAgentWorktreeDialog.tsx";
import {
  DashboardLiveRefreshProvider,
  useDashboardLiveRefresh,
} from "../../dashboard-live-refresh.tsx";
import { createSpacesFetchGate } from "../../spaces-fetch-generation.ts";
import {
  discoverT3ImportSessions,
  listT3ImportInstances,
  unclaimedT3ImportSessions,
} from "../../t3-api.ts";
import {
  discoverPaseoImportSessions,
  listPaseoImportInstances,
  unclaimedPaseoImportSessions,
} from "../../paseo-api.ts";
import { SpaceSessionRoster } from "./SpaceSessionRoster.tsx";
import { SpaceActivityHistory } from "./SpaceActivityHistory.tsx";
import { codexReasoningEfforts, type CodexReasoningEffort } from "../../codex-reasoning-effort.ts";
import { chrome, menu } from "./NewDashboardChrome.stylex.ts";
import {
  Avatar,
  Icon,
  Sidebar,
  SpaceActionsTrigger,
  SpaceMenuContent,
  Status,
  type DashboardNotificationChromeProps,
} from "./NewDashboardChrome.tsx";
import { dialogs } from "./NewDashboardDialogs.stylex.ts";
import { explorer } from "./NewDashboardExplorer.stylex.ts";
import { DashboardSpaceHeader } from "./NewDashboardSpaceHeader.tsx";
import {
  agentCreateButtonLabel,
  gitPickerEmptyMessage,
  gitPickerEyebrow,
  gitPickerTitle,
  knownRepositoriesFromSpaces,
  needsRepositoryPickerForWorktree,
  repositoriesForGitPicker,
  resolveWorktreeBaseRef,
  shouldShowAttachRepositoryInGitPicker,
  worktreeCreateButtonLabel,
  type GitPickerPurpose,
} from "../../space-worktree-create.ts";
import { nextSessionPinState, sessionPinActionLabel } from "../../organize-tree.ts";
import {
  isSessionLinkContextTarget,
  shouldDismissSessionContextMenu,
} from "../../session-context-menu.ts";

function TreeRow({
  depth = 0,
  icon = "folder",
  label,
  detail,
  badge,
  meta,
  active,
  onClick,
  onContextMenu,
}: {
  depth?: number;
  icon?: "folder" | "repo" | "branch" | "session";
  label: string;
  detail?: string;
  badge?: string;
  meta?: string;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      {...stylex.props(explorer.treeRow(depth), active && explorer.treeRowActive)}
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span {...stylex.props(explorer.treeRowIcon)}>
        <Icon name={icon} />
      </span>
      <span>
        <span {...stylex.props(explorer.treeRowLabel)}>{label}</span>
        {detail ? <small {...stylex.props(explorer.treeRowDetail)}>{detail}</small> : null}
      </span>
      {badge ? (
        <small {...stylex.props(explorer.treeRowBadge)}>{badge}</small>
      ) : meta ? (
        <small {...stylex.props(explorer.treeRowMeta)}>{meta}</small>
      ) : null}
      <span {...stylex.props(explorer.treeRowChevron)}>
        <Icon name="chevron" />
      </span>
    </button>
  );
}

const PRIMARY_CHECKOUT = "__primary__";

function createProvider(value: string | undefined): CreateProvider {
  const normalized = value?.toLocaleLowerCase();
  if (
    normalized === "claude" ||
    normalized === "codex" ||
    normalized === "cursor" ||
    normalized === "grok"
  ) {
    return normalized;
  }
  return "opencode";
}

function primaryBranch(repo: PrototypeRepo): string {
  return repo.primaryBranch ?? repo.worktrees[0] ?? "main";
}

function linkedWorktrees(repo: PrototypeRepo): string[] {
  return repo.primaryBranch ? repo.worktrees : repo.worktrees.slice(1);
}

function worktreeBranch(repo: PrototypeRepo, worktree: string): string {
  const branch = repo.worktreeBranches?.[worktree] ?? worktree;
  return branch === "(detached)" ? "Detached HEAD" : branch;
}

function availableWorktreeBranch(repo: PrototypeRepo, worktree: string): string {
  const branch = repo.availableWorktreeBranches?.[worktree] ?? worktree;
  return branch === "(detached)" ? "Detached HEAD" : branch;
}

function worktreePath(parent: string, repoName: string, worktreeName: string): string {
  const folder = `${repoName}-${worktreeName.replaceAll("/", "-")}`;
  const normalizedParent = parent.trim().replace(/\/+$/, "");
  return normalizedParent === "/" ? `/${folder}` : `${normalizedParent}/${folder}`;
}

function SpaceTree({
  spaces,
  parentId,
  selectedSpaceId,
  depth = 0,
  onSelect,
  onContextMenu,
}: {
  spaces: PrototypeSpace[];
  parentId: string | null;
  selectedSpaceId: string;
  depth?: number;
  onSelect: (spaceId: string) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>, spaceId: string) => void;
}) {
  return sortSpacesBySortOrder(
    spaces.filter((space) => !space.archived && space.parentId === parentId),
  ).map((space) => (
    <div key={space.id}>
      <TreeRow
        depth={depth}
        label={space.name}
        meta={String(space.sessions.filter((session) => !session.archived).length)}
        active={space.id === selectedSpaceId}
        onClick={() => onSelect(space.id)}
        onContextMenu={(event) => onContextMenu(event, space.id)}
      />
      <SpaceTree
        spaces={spaces}
        parentId={space.id}
        selectedSpaceId={selectedSpaceId}
        depth={depth + 1}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
      />
    </div>
  ));
}

function ExplorerDashboard() {
  const navigate = useNavigate();
  const { spaceId } = useParams<{ spaceId?: string }>();
  const [searchParams] = useSearchParams();
  const routeRepoId = searchParams.get("repo");
  const routeWorktreeId = searchParams.get("worktreeId");
  const routeWorktree = searchParams.get("worktree");
  const [prototype, setPrototype] = useState<PrototypeSpacesState>({
    spaces: [],
    selectedSpaceId: "",
  });
  const [loading, setLoading] = useState(true);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [profile] = useState(loadPrototypeProfile);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const [spacePickerSearch, setSpacePickerSearch] = useState("");
  const [spacePickerIndex, setSpacePickerIndex] = useState(0);
  const [gitPickerOpen, setGitPickerOpen] = useState(false);
  const [gitPickerSearch, setGitPickerSearch] = useState("");
  const [gitPickerPurpose, setGitPickerPurpose] = useState<GitPickerPurpose>("browse");
  const [includeSubspaces, setIncludeSubspaces] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);
  const [spaceOrganizeOpen, setSpaceOrganizeOpen] = useState(false);
  const [spaceOrganizeParentId, setSpaceOrganizeParentId] = useState<string | null>(null);
  const [spaceOrganizeDraggingId, setSpaceOrganizeDraggingId] = useState<string | null>(null);
  const [spaceOrganizeBusy, setSpaceOrganizeBusy] = useState(false);
  const liveRefresh = useDashboardLiveRefresh();
  const spacesFetchGate = useRef(createSpacesFetchGate()).current;
  const [spaceContextMenu, setSpaceContextMenu] = useState<{
    spaceId: string;
    x: number;
    y: number;
    opener: HTMLElement | null;
  } | null>(null);
  const [sessionContextMenu, setSessionContextMenu] = useState<{
    sessionId: string;
    x: number;
    y: number;
  } | null>(null);
  const [moveSessionId, setMoveSessionId] = useState<string | null>(null);
  const [moveSpaceId, setMoveSpaceId] = useState<string | null>(null);
  const [moveBrowseSpaceId, setMoveBrowseSpaceId] = useState<string | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [moveSearchIndex, setMoveSearchIndex] = useState(0);
  const [spaceForm, setSpaceForm] = useState<"create" | "edit" | null>(null);
  const [spaceName, setSpaceName] = useState("");
  const [spaceParentId, setSpaceParentId] = useState<string | null>(null);
  const [spaceContext, setSpaceContext] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(routeRepoId);
  const [selectedWorktreeName, setSelectedWorktreeName] = useState<string | null>(routeWorktree);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(routeWorktreeId);
  const [repoContextMenu, setRepoContextMenu] = useState<{
    repoId: string;
    x: number;
    y: number;
  } | null>(null);
  const [worktreeContextMenu, setWorktreeContextMenu] = useState<{
    repoId: string;
    worktree: string;
    x: number;
    y: number;
  } | null>(null);
  const [worktreeMenuOpen, setWorktreeMenuOpen] = useState(false);
  const [attachRepoOpen, setAttachRepoOpen] = useState(false);
  const [customRepoName, setCustomRepoName] = useState("");
  const [customRepoPath, setCustomRepoPath] = useState("");
  const [editRepoPathOpen, setEditRepoPathOpen] = useState(false);
  const [repoNameDraft, setRepoNameDraft] = useState("");
  const [repoPathDraft, setRepoPathDraft] = useState("");
  const [worktreeFormOpen, setWorktreeFormOpen] = useState(false);
  const [worktreeNameDraft, setWorktreeNameDraft] = useState("");
  const [worktreeBase, setWorktreeBase] = useState("main");
  const [worktreeParentDraft, setWorktreeParentDraft] = useState("");
  const [preferredWorktreeParent, setPreferredWorktreeParent] = useState<string | null>(null);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [createJarvisOpen, setCreateJarvisOpen] = useState(false);
  const [createJarvisBusy, setCreateJarvisBusy] = useState(false);
  const createJarvisOpenerRef = useRef<HTMLElement | null>(null);
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [agentDialogBusy, setAgentDialogBusy] = useState(false);
  const [agentDialogBase, setAgentDialogBase] = useState("main");
  const agentDialogOpenerRef = useRef<HTMLElement | null>(null);
  const [sessionProvider, setSessionProvider] = useState<CreateProvider>("opencode");
  const [providerModels, setProviderModels] = useState<ProviderModel[]>([]);
  const [sessionModelId, setSessionModelId] = useState("");
  const [sessionReasoningEffort, setSessionReasoningEffort] = useState<CodexReasoningEffort | "">(
    "",
  );
  const [sessionModelsLoading, setSessionModelsLoading] = useState(false);
  const [sessionCreating, setSessionCreating] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importSearch, setImportSearch] = useState("");
  const [importProvider, setImportProvider] = useState("all");
  const [importingSessionId, setImportingSessionId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [t3ImportSessions, setT3ImportSessions] = useState<PrototypeSession[]>([]);
  const [t3ImportProviderLabels, setT3ImportProviderLabels] = useState<Record<string, string>>({});
  const [t3ImportLoading, setT3ImportLoading] = useState(false);
  const [paseoImportSessions, setPaseoImportSessions] = useState<PrototypeSession[]>([]);
  const [paseoImportProviderLabels, setPaseoImportProviderLabels] = useState<
    Record<string, string>
  >({});
  const [paseoImportLoading, setPaseoImportLoading] = useState(false);

  const routeSpace = spaceId ? prototype.spaces.find((space) => space.id === spaceId) : undefined;
  const emptySpace: PrototypeSpace = {
    id: "loading",
    name: "Loading spaces",
    parentId: null,
    archived: false,
    context: "Loading the database-backed dashboard…",
    repos: [],
    sessions: [],
    importableSessions: [],
  };
  const selectedSpace =
    routeSpace ??
    prototype.spaces.find((space) => space.id === prototype.selectedSpaceId) ??
    prototype.spaces.find((space) => !space.archived) ??
    emptySpace;
  const allGitContexts = selectedRepoId === null;
  const selectedRepo = selectedRepoId
    ? selectedSpace.repos.find((repo) => repo.id === selectedRepoId)
    : selectedSpace.repos[0];
  const contextRepo = repoContextMenu
    ? selectedSpace.repos.find((repo) => repo.id === repoContextMenu.repoId)
    : undefined;
  const contextWorktreeRepo = worktreeContextMenu
    ? selectedSpace.repos.find((repo) => repo.id === worktreeContextMenu.repoId)
    : undefined;
  const selectedWorktree = (() => {
    if (!selectedRepo) return undefined;
    if (selectedWorktreeId && selectedRepo.worktreeIds) {
      const byId = Object.entries(selectedRepo.worktreeIds).find(
        ([, id]) => id === selectedWorktreeId,
      );
      if (byId) return byId[0];
      if (selectedRepo.primaryWorktreeId === selectedWorktreeId) return PRIMARY_CHECKOUT;
    }
    if (
      selectedWorktreeName &&
      (selectedWorktreeName === PRIMARY_CHECKOUT ||
        linkedWorktrees(selectedRepo).includes(selectedWorktreeName))
    ) {
      return selectedWorktreeName;
    }
    return undefined;
  })();
  const selectedCheckoutLabel =
    selectedWorktree === PRIMARY_CHECKOUT ? "Primary checkout" : selectedWorktree;
  const selectedBranch = selectedRepo
    ? selectedWorktree === PRIMARY_CHECKOUT
      ? primaryBranch(selectedRepo)
      : selectedWorktree
        ? worktreeBranch(selectedRepo, selectedWorktree)
        : undefined
    : undefined;
  const selectedWorktreePath = selectedRepo
    ? selectedWorktree && selectedWorktree !== PRIMARY_CHECKOUT
      ? (selectedRepo.worktreePaths?.[selectedWorktree] ??
        `${selectedRepo.path}-${selectedWorktree}`)
      : selectedRepo.path
    : "No local folder selected";
  const worktreeDestination = selectedRepo
    ? worktreePath(
        worktreeParentDraft || preferredWorktreeParent || DEFAULT_WORKTREE_PARENT_PATH,
        selectedRepo.name,
        worktreeNameDraft.trim() || "new-worktree",
      )
    : "";
  const selectedParentName = selectedSpace.parentId
    ? (prototype.spaces.find((space) => space.id === selectedSpace.parentId)?.name ?? "Unknown")
    : "Top level";
  const selectedParent = selectedSpace.parentId
    ? prototype.spaces.find((space) => space.id === selectedSpace.parentId)
    : undefined;
  const spaceParentOptions = prototype.spaces.filter((space) => !space.archived);
  const spaceParent = spaceParentId
    ? prototype.spaces.find((space) => space.id === spaceParentId)
    : undefined;
  const spaceParentLabel = spaceParent ? pathForSpace(spaceParent) : "Top level";
  const archivedRoots = prototype.spaces.filter(
    (space) =>
      space.archived &&
      (!space.parentId || !prototype.spaces.find((item) => item.id === space.parentId)?.archived),
  );
  const descendantSpaceIds = new Set([selectedSpace.id]);
  let foundScopedDescendant = true;
  while (foundScopedDescendant) {
    foundScopedDescendant = false;
    for (const space of prototype.spaces) {
      if (
        space.parentId &&
        descendantSpaceIds.has(space.parentId) &&
        !descendantSpaceIds.has(space.id)
      ) {
        descendantSpaceIds.add(space.id);
        foundScopedDescendant = true;
      }
    }
  }
  const scopedSpaceIds = includeSubspaces ? descendantSpaceIds : new Set([selectedSpace.id]);
  const descendantCount = descendantSpaceIds.size - 1;
  const visibleSessions = sortPrototypeRosterSessions(
    prototype.spaces
      .filter((space) => scopedSpaceIds.has(space.id))
      .flatMap((space) =>
        space.sessions.map((session) => ({ ...session, sourceSpaceName: space.name })),
      )
      .filter(
        (session) =>
          !session.archived &&
          (allGitContexts ||
            (session.repoId === selectedRepo?.id &&
              (!selectedWorktree || session.worktree === selectedWorktree))),
      ),
  );
  const contextSession = sessionContextMenu
    ? (visibleSessions.find((session) => session.id === sessionContextMenu.sessionId) ??
      selectedSpace.sessions.find((session) => session.id === sessionContextMenu.sessionId))
    : undefined;
  const localImportableSessions = (selectedSpace.importableSessions ?? []).filter(
    (session) =>
      !session.archived &&
      (allGitContexts ||
        (session.repoId === selectedRepo?.id &&
          (!selectedWorktree || session.worktree === selectedWorktree))),
  );
  const importableSessions = [
    ...localImportableSessions,
    ...t3ImportSessions.filter(
      (t3Session) => !localImportableSessions.some((session) => session.id === t3Session.id),
    ),
    ...paseoImportSessions.filter(
      (paseoSession) => !localImportableSessions.some((session) => session.id === paseoSession.id),
    ),
  ];
  const importProviders = Array.from(
    new Set([
      ...Object.values(t3ImportProviderLabels),
      ...Object.values(paseoImportProviderLabels),
      ...importableSessions.map((session) => session.provider),
    ]),
  ).sort((left, right) => left.localeCompare(right));
  const workingCount = visibleSessions.filter(
    (session) => session.rosterStatus === "working",
  ).length;
  const spaceScopedSessionIds = prototype.spaces
    .filter((space) => scopedSpaceIds.has(space.id))
    .flatMap((space) => space.sessions)
    .filter((session) => !session.archived)
    .map((session) => session.id);
  const notificationChrome: DashboardNotificationChromeProps = {
    spaceId: selectedSpace.id === "loading" ? null : selectedSpace.id,
    spaceName: selectedSpace.name,
    spaceSessionIds: spaceScopedSessionIds,
    workingCount,
    notifications: liveRefresh.notifications,
    notificationsLoaded: liveRefresh.notificationsLoaded,
    notificationsError: liveRefresh.notificationsError,
    onDismissNotification: liveRefresh.dismissNotification,
  };
  const normalizedImportSearch = importSearch.trim().toLocaleLowerCase();
  const filteredImportableSessions = importableSessions.filter(
    (session) =>
      (importProvider === "all" ||
        session.provider === importProvider ||
        (session.t3InstanceId != null &&
          t3ImportProviderLabels[session.t3InstanceId] === importProvider) ||
        (session.paseoInstanceId != null &&
          paseoImportProviderLabels[session.paseoInstanceId] === importProvider)) &&
      (!normalizedImportSearch ||
        session.title.toLocaleLowerCase().includes(normalizedImportSearch) ||
        session.agent.toLocaleLowerCase().includes(normalizedImportSearch) ||
        session.model.toLocaleLowerCase().includes(normalizedImportSearch)),
  );

  useEffect(() => {
    if (!importDialogOpen || !selectedRepo || !selectedWorktree) {
      setT3ImportSessions([]);
      setT3ImportProviderLabels({});
      setT3ImportLoading(false);
      return;
    }
    const controller = new AbortController();
    void listT3ImportInstances(controller.signal)
      .then((instances) =>
        setT3ImportProviderLabels(
          Object.fromEntries(instances.map((instance) => [instance.id, instance.label])),
        ),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setImportError(error instanceof Error ? error.message : "Unable to list T3 instances.");
        }
      });
    setT3ImportLoading(true);
    void discoverT3ImportSessions(selectedWorktreePath, controller.signal)
      .then((sessions) => {
        const worktreeId =
          selectedWorktreeId ??
          (selectedWorktree === PRIMARY_CHECKOUT ? selectedRepo.primaryWorktreeId : undefined);
        setT3ImportSessions(
          unclaimedT3ImportSessions(sessions).map((session) => ({
            id: session.sessionId,
            t3InstanceId: session.instanceId,
            title: session.title?.trim() || session.sessionId,
            agent: "T3",
            provider: t3ImportProviderLabels[session.instanceId] ?? `T3 (${session.instanceId})`,
            model: session.branch?.trim() || "T3 thread",
            status: "Attached",
            tone: "blue",
            repoId: selectedRepo.id,
            worktree: selectedWorktree,
            worktreeId,
            archived: false,
            workspacePath: session.worktreePath || session.workspaceRoot,
            workspaceLabel: null,
            importedAt: null,
          })),
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setT3ImportSessions([]);
          setImportError(error instanceof Error ? error.message : "Unable to scan T3 instances.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setT3ImportLoading(false);
      });
    return () => controller.abort();
  }, [importDialogOpen, selectedRepo, selectedWorktree, selectedWorktreePath, selectedWorktreeId]);

  useEffect(() => {
    if (!importDialogOpen || !selectedRepo || !selectedWorktree) {
      setPaseoImportSessions([]);
      setPaseoImportProviderLabels({});
      setPaseoImportLoading(false);
      return;
    }
    const controller = new AbortController();
    void listPaseoImportInstances(controller.signal)
      .then((instances) => {
        setPaseoImportProviderLabels(
          Object.fromEntries(instances.map((instance) => [instance.id, instance.label])),
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setImportError(
            error instanceof Error ? error.message : "Unable to list Paseo instances.",
          );
      });
    setPaseoImportLoading(true);
    void discoverPaseoImportSessions(selectedWorktreePath, controller.signal)
      .then((sessions) => {
        const worktreeId =
          selectedWorktreeId ??
          (selectedWorktree === PRIMARY_CHECKOUT ? selectedRepo.primaryWorktreeId : undefined);
        setPaseoImportSessions(
          unclaimedPaseoImportSessions(sessions).map((session) => {
            const isChat = detectPrefixedSessionBackend(session.sessionId) === "paseo-chat";
            return {
              id: session.sessionId,
              paseoInstanceId: session.instanceId,
              title: session.title?.trim() || session.sessionId,
              agent: isChat ? "Paseo Chat" : "Paseo",
              provider:
                paseoImportProviderLabels[session.instanceId] ?? `Paseo (${session.instanceId})`,
              model: isChat ? "Paseo room" : "Paseo agent",
              status: "Attached",
              tone: "blue",
              repoId: selectedRepo.id,
              worktree: selectedWorktree,
              worktreeId,
              archived: false,
              workspacePath: session.cwd,
              workspaceLabel: null,
              importedAt: null,
            };
          }),
        );
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setPaseoImportSessions([]);
          setImportError(
            error instanceof Error ? error.message : "Unable to scan Paseo instances.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPaseoImportLoading(false);
      });
    return () => controller.abort();
  }, [importDialogOpen, selectedRepo, selectedWorktree, selectedWorktreePath, selectedWorktreeId]);
  let movingSession: PrototypeSession | undefined;
  let movingSourceSpace: PrototypeSpace | undefined;
  if (moveSessionId) {
    for (const space of prototype.spaces) {
      const session = space.sessions.find((item) => item.id === moveSessionId);
      if (session) {
        movingSession = session;
        movingSourceSpace = space;
        break;
      }
    }
  }
  const movingSpace = moveSpaceId
    ? prototype.spaces.find((space) => space.id === moveSpaceId)
    : undefined;
  const movingSpaceTreeIds = new Set<string>();
  if (movingSpace) {
    movingSpaceTreeIds.add(movingSpace.id);
    let foundMovingDescendant = true;
    while (foundMovingDescendant) {
      foundMovingDescendant = false;
      for (const space of prototype.spaces) {
        if (
          space.parentId &&
          movingSpaceTreeIds.has(space.parentId) &&
          !movingSpaceTreeIds.has(space.id)
        ) {
          movingSpaceTreeIds.add(space.id);
          foundMovingDescendant = true;
        }
      }
    }
  }
  const moveBrowseSpace = moveBrowseSpaceId
    ? prototype.spaces.find((space) => space.id === moveBrowseSpaceId)
    : undefined;
  const moveChildren = prototype.spaces.filter(
    (space) =>
      !space.archived && space.parentId === moveBrowseSpaceId && !movingSpaceTreeIds.has(space.id),
  );
  const moveCrumbs: PrototypeSpace[] = [];
  let moveCursor = moveBrowseSpace;
  while (moveCursor) {
    moveCrumbs.unshift(moveCursor);
    moveCursor = moveCursor.parentId
      ? prototype.spaces.find((space) => space.id === moveCursor?.parentId)
      : undefined;
  }
  const moveAlreadyHere = movingSpace
    ? movingSpace.parentId === moveBrowseSpaceId
    : !moveBrowseSpaceId || movingSourceSpace?.id === moveBrowseSpaceId;
  function pathForSpace(space: PrototypeSpace): string {
    const names = [space.name];
    const seen = new Set([space.id]);
    let parent = space.parentId
      ? prototype.spaces.find((item) => item.id === space.parentId)
      : undefined;
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(parent.name);
      parent = parent.parentId
        ? prototype.spaces.find((item) => item.id === parent?.parentId)
        : undefined;
    }
    return names.join(" / ");
  }
  const normalizedMoveSearch = moveSearch.trim().toLocaleLowerCase();
  const moveSearchResults = normalizedMoveSearch
    ? prototype.spaces
        .filter((space) => !space.archived && !movingSpaceTreeIds.has(space.id))
        .map((space) => ({ space, path: pathForSpace(space) }))
        .filter(({ path }) => path.toLocaleLowerCase().includes(normalizedMoveSearch))
        .slice(0, 8)
    : [];
  const normalizedSpacePickerSearch = spacePickerSearch.trim().toLocaleLowerCase();
  const spacePickerResults = flattenSpacesDepthFirst(
    prototype.spaces.filter((space) => !space.archived),
  )
    .map((space) => ({ space, path: pathForSpace(space) }))
    .filter(({ path }) => path.toLocaleLowerCase().includes(normalizedSpacePickerSearch));
  const normalizedGitPickerSearch = gitPickerSearch.trim().toLocaleLowerCase();
  const showAllGitOption =
    !normalizedGitPickerSearch || "this space all git contexts".includes(normalizedGitPickerSearch);
  const showSubspacesOption =
    descendantCount > 0 &&
    (!normalizedGitPickerSearch ||
      `everything in ${selectedSpace.name} subspaces`
        .toLocaleLowerCase()
        .includes(normalizedGitPickerSearch));
  const knownRepos = knownRepositoriesFromSpaces(prototype.spaces);
  const gitPickerSourceRepos = repositoriesForGitPicker(
    gitPickerPurpose,
    selectedSpace.repos,
    knownRepos,
  );
  const gitPickerResults = gitPickerSourceRepos.filter(
    (repo) =>
      !normalizedGitPickerSearch ||
      repo.name.toLocaleLowerCase().includes(normalizedGitPickerSearch) ||
      primaryBranch(repo).toLocaleLowerCase().includes(normalizedGitPickerSearch) ||
      linkedWorktrees(repo).some(
        (worktree) =>
          worktree.toLocaleLowerCase().includes(normalizedGitPickerSearch) ||
          worktreeBranch(repo, worktree).toLocaleLowerCase().includes(normalizedGitPickerSearch),
      ) ||
      (repo.availableWorktrees ?? []).some(
        (worktree) =>
          worktree.toLocaleLowerCase().includes(normalizedGitPickerSearch) ||
          availableWorktreeBranch(repo, worktree)
            .toLocaleLowerCase()
            .includes(normalizedGitPickerSearch),
      ),
  );

  function chooseMoveSearchResult(spaceId: string) {
    setMoveBrowseSpaceId(spaceId);
    setMoveSearch("");
    setMoveSearchIndex(0);
  }

  /** Apply authoritative spaces state and invalidate any in-flight GET. */
  function commitSpaceState(next: PrototypeSpacesState) {
    spacesFetchGate.begin();
    setPrototype(next);
    setRequestError(null);
  }

  async function reloadSpaces(options?: { quiet?: boolean }): Promise<PrototypeSpacesState | null> {
    const token = spacesFetchGate.begin();
    try {
      const next = await fetchSpaceState();
      if (!spacesFetchGate.isCurrent(token)) return null;
      setPrototype(next);
      setRequestError(null);
      return next;
    } catch (error) {
      if (!spacesFetchGate.isCurrent(token)) return null;
      if (!options?.quiet) {
        setRequestError(error instanceof Error ? error.message : "Unable to refresh spaces.");
      }
      return null;
    }
  }

  useEffect(() => {
    const token = spacesFetchGate.begin();
    void fetchSpaceState()
      .then((next) => {
        if (!spacesFetchGate.isCurrent(token)) return;
        setPrototype(next);
        setRequestError(null);
      })
      .catch((error: unknown) => {
        if (!spacesFetchGate.isCurrent(token)) return;
        setRequestError(error instanceof Error ? error.message : "Unable to load spaces.");
      })
      .finally(() => {
        if (spacesFetchGate.isCurrent(token)) setLoading(false);
      });
  }, [spacesFetchGate]);

  // Live roster + history freshness comes from DashboardLiveRefreshProvider
  // (shared sessions + notifications SSE, debounced). Refetch spaces when the
  // shared refresh token advances — no per-row polling, no duplicate EventSources.
  useEffect(() => {
    if (liveRefresh.refreshToken === 0) return;
    const token = spacesFetchGate.begin();
    void fetchSpaceState()
      .then((next) => {
        if (!spacesFetchGate.isCurrent(token)) return;
        setPrototype(next);
        setRequestError(null);
      })
      .catch(() => {
        // Keep the last good roster; surface transient live issues only if empty.
      });
  }, [liveRefresh.refreshToken, spacesFetchGate]);

  useEffect(() => {
    let active = true;
    void fetchSettings()
      .then((settings) => {
        if (active) setPreferredWorktreeParent(settings.preferredWorktreeParentPath);
      })
      .catch(() => {
        // The repository parent remains a safe fallback when settings are unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionDialogOpen || sessionProvider === "opencode") {
      setProviderModels([]);
      setSessionModelId("");
      setSessionModelsLoading(false);
      return;
    }
    let active = true;
    setSessionModelsLoading(true);
    void fetchProviderModels(sessionProvider)
      .then((models) => {
        if (!active) return;
        setProviderModels(models);
        setSessionModelId((current) => {
          if (models.some((model) => model.id === current)) return current;
          const preferred = selectedSpace.defaultModel?.toLocaleLowerCase();
          return (
            models.find(
              (model) =>
                model.id.toLocaleLowerCase() === preferred ||
                model.name.toLocaleLowerCase() === preferred,
            )?.id ??
            models[0]?.id ??
            ""
          );
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setProviderModels([]);
        setSessionModelId("");
        setSessionError(error instanceof Error ? error.message : "Unable to load models.");
      })
      .finally(() => {
        if (active) setSessionModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedSpace.defaultModel, sessionDialogOpen, sessionProvider]);

  useEffect(() => {
    if (!sessionDialogOpen && !importDialogOpen && !createJarvisOpen && !agentDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [agentDialogOpen, createJarvisOpen, importDialogOpen, sessionDialogOpen]);

  async function applyMutation(
    mutation: Promise<{ state: PrototypeSpacesState }>,
  ): Promise<PrototypeSpacesState | null> {
    try {
      const next = await mutation;
      commitSpaceState(next.state);
      return next.state;
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "The spaces change failed.");
      return null;
    }
  }

  useEffect(() => {
    if (!spaceId || loading) return;
    if (!routeSpace || routeSpace.archived) {
      void navigate("/dashboard", { replace: true });
      return;
    }
    if (prototype.selectedSpaceId !== routeSpace.id) {
      setPrototype((current) => ({ ...current, selectedSpaceId: routeSpace.id }));
    }
  }, [loading, navigate, prototype.selectedSpaceId, routeSpace, spaceId]);

  useEffect(() => {
    setSelectedRepoId(routeRepoId);
    setSelectedWorktreeId(routeWorktreeId);
    setSelectedWorktreeName(routeWorktree);
    setIncludeSubspaces(false);
  }, [routeRepoId, routeWorktree, routeWorktreeId]);

  useEffect(() => {
    if (
      !spaceMenuOpen &&
      !spaceContextMenu &&
      !sessionContextMenu &&
      !repoContextMenu &&
      !worktreeContextMenu &&
      !worktreeMenuOpen &&
      !moveSearch
    )
      return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (spaceMenuOpen && !target.closest("[data-space-menu]")) {
        setSpaceMenuOpen(false);
      }
      if (spaceContextMenu && !target.closest("[data-space-context-menu]")) {
        setSpaceContextMenu(null);
      }
      if (sessionContextMenu && !target.closest("[data-session-context-menu]")) {
        setSessionContextMenu(null);
      }
      if (repoContextMenu && !target.closest("[data-repo-context-menu]")) {
        setRepoContextMenu(null);
      }
      if (worktreeContextMenu && !target.closest("[data-worktree-context-menu]")) {
        setWorktreeContextMenu(null);
      }
      if (worktreeMenuOpen && !target.closest("[data-worktree-menu]")) {
        setWorktreeMenuOpen(false);
      }
      if (moveSearch && !target.closest("[data-move-search]")) {
        setMoveSearch("");
        setMoveSearchIndex(0);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (spaceMenuOpen) setSpaceMenuOpen(false);
      if (spaceContextMenu) setSpaceContextMenu(null);
      if (sessionContextMenu) setSessionContextMenu(null);
      if (repoContextMenu) setRepoContextMenu(null);
      if (worktreeContextMenu) setWorktreeContextMenu(null);
      if (worktreeMenuOpen) setWorktreeMenuOpen(false);
    }
    function onContextMenu(event: MouseEvent) {
      if (!sessionContextMenu) return;
      if (!shouldDismissSessionContextMenu(event.target)) return;
      setSessionContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    moveSearch,
    repoContextMenu,
    sessionContextMenu,
    spaceContextMenu,
    spaceMenuOpen,
    worktreeContextMenu,
    worktreeMenuOpen,
  ]);

  useEffect(() => {
    if (
      !spaceForm &&
      !moveSessionId &&
      !moveSpaceId &&
      !attachRepoOpen &&
      !editRepoPathOpen &&
      !worktreeFormOpen &&
      !spacePickerOpen &&
      !gitPickerOpen &&
      !sessionDialogOpen &&
      !createJarvisOpen &&
      !agentDialogOpen &&
      !importDialogOpen
    )
      return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (moveSessionId || moveSpaceId) {
        if (moveSearch) {
          setMoveSearch("");
          setMoveSearchIndex(0);
          return;
        }
        setMoveSessionId(null);
        setMoveSpaceId(null);
        return;
      }
      if (attachRepoOpen) {
        setAttachRepoOpen(false);
        return;
      }
      if (editRepoPathOpen) {
        setEditRepoPathOpen(false);
        return;
      }
      if (worktreeFormOpen) {
        setWorktreeFormOpen(false);
        return;
      }
      if (createJarvisOpen) {
        if (!createJarvisBusy) setCreateJarvisOpen(false);
        return;
      }
      if (agentDialogOpen) {
        if (!agentDialogBusy) setAgentDialogOpen(false);
        return;
      }
      if (sessionDialogOpen) {
        if (!sessionCreating) setSessionDialogOpen(false);
        return;
      }
      if (importDialogOpen) {
        if (!importingSessionId) setImportDialogOpen(false);
        return;
      }
      if (gitPickerOpen) {
        setGitPickerOpen(false);
        return;
      }
      if (spacePickerOpen) {
        setSpacePickerOpen(false);
        return;
      }
      if (spaceOrganizeOpen) {
        setSpaceOrganizeOpen(false);
        return;
      }
      setSpaceForm(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    agentDialogBusy,
    agentDialogOpen,
    attachRepoOpen,
    createJarvisBusy,
    createJarvisOpen,
    editRepoPathOpen,
    gitPickerOpen,
    importDialogOpen,
    importingSessionId,
    moveSearch,
    moveSessionId,
    moveSpaceId,
    spaceForm,
    spaceOrganizeOpen,
    spacePickerOpen,
    sessionCreating,
    sessionDialogOpen,
    worktreeFormOpen,
  ]);

  function selectSpace(spaceId: string) {
    setPrototype((current) => ({ ...current, selectedSpaceId: spaceId }));
    void navigate(`/dashboard/${encodeURIComponent(spaceId)}`);
    setIncludeSubspaces(false);
    setSelectedRepoId(null);
    setSelectedWorktreeName(null);
    setSelectedWorktreeId(null);
    setRepoContextMenu(null);
    setWorktreeMenuOpen(false);
    setSpacePickerOpen(false);
  }

  function openSpaceNavigator() {
    if (window.innerWidth <= 760) {
      setSpacePickerSearch("");
      setSpacePickerIndex(0);
      setSpacePickerOpen(true);
      return;
    }
    document.querySelector<HTMLElement>("[data-spaces-tree] button")?.focus();
  }

  function openGitPicker(purpose: GitPickerPurpose = "browse") {
    setGitPickerSearch("");
    setGitPickerPurpose(purpose);
    setGitPickerOpen(true);
  }

  function setGitContext(repoId: string | null, worktree: string | null) {
    setIncludeSubspaces(false);
    setSelectedRepoId(repoId);
    setSelectedWorktreeName(worktree);
    const repo = repoId ? selectedSpace.repos.find((item) => item.id === repoId) : undefined;
    const worktreeId =
      repo && worktree ? (repo.worktreeIds?.[worktree] ?? repo.primaryWorktreeId ?? null) : null;
    setSelectedWorktreeId(worktreeId);
    const params = new URLSearchParams();
    if (repoId) params.set("repo", repoId);
    if (worktreeId) params.set("worktreeId", worktreeId);
    else if (worktree) params.set("worktree", worktree);
    const suffix = params.size ? `?${params.toString()}` : "";
    void navigate(`/dashboard/${encodeURIComponent(selectedSpace.id)}${suffix}`, { replace: true });
  }

  function openCreateJarvis(opener?: HTMLElement | null) {
    if (
      selectedSpace.id === "loading" ||
      !prototype.spaces.some((s) => s.id === selectedSpace.id)
    ) {
      setRequestError("Create or select a space before creating Jarvis.");
      setSpaceMenuOpen(false);
      setSpaceContextMenu(null);
      return;
    }
    // Prefer an explicit opener (Space actions trigger or context-menu target).
    // Never fall back to querySelector — multiple Space actions buttons exist
    // (mobile + desktop) and the first match is often the wrong one.
    createJarvisOpenerRef.current = opener ?? null;
    setRequestError(null);
    setCreateJarvisOpen(true);
    setSpaceMenuOpen(false);
    setSpaceContextMenu(null);
  }

  function openSessionDialog() {
    if (!selectedRepo || !selectedWorktree) {
      openGitPicker("new-session");
      return;
    }
    setSessionProvider(createProvider(selectedSpace.defaultProvider));
    setSessionReasoningEffort("");
    setSessionError(null);
    setCreatedSessionId(null);
    setSessionDialogOpen(true);
  }

  function openImportDialog() {
    if (!selectedRepo || !selectedWorktree) {
      openGitPicker("import");
      return;
    }
    setImportSearch("");
    setImportProvider("all");
    setImportError(null);
    setImportDialogOpen(true);
  }

  function openAgentDialog(opener?: HTMLElement | null) {
    if (needsRepositoryPickerForWorktree(selectedRepoId) || !selectedRepo) {
      agentDialogOpenerRef.current = opener ?? null;
      openGitPicker("new-agent");
      return;
    }
    const base =
      selectedWorktree && selectedWorktree !== PRIMARY_CHECKOUT
        ? worktreeBranch(selectedRepo, selectedWorktree)
        : primaryBranch(selectedRepo);
    agentDialogOpenerRef.current = opener ?? null;
    setAgentDialogBase(base);
    setRequestError(null);
    setAgentDialogOpen(true);
  }

  function chooseGitContext(repoId: string, worktree: string) {
    if (gitPickerPurpose === "new-worktree") {
      const repo = gitPickerSourceRepos.find((item) => item.id === repoId);
      if (repo) void chooseRepoForNewWorktree(repo, worktree);
      return;
    }
    if (gitPickerPurpose === "new-agent") {
      const repo = gitPickerSourceRepos.find((item) => item.id === repoId);
      if (repo) void chooseRepoForNewAgent(repo, worktree);
      return;
    }
    setGitContext(repoId, worktree);
    setGitPickerOpen(false);
    if (gitPickerPurpose === "new-session") {
      setSessionProvider(createProvider(selectedSpace.defaultProvider));
      setSessionReasoningEffort("");
      setSessionError(null);
      setCreatedSessionId(null);
      setSessionDialogOpen(true);
    } else if (gitPickerPurpose === "import") {
      setImportSearch("");
      setImportProvider("all");
      setImportError(null);
      setImportDialogOpen(true);
    }
  }

  async function ensureRepoOnSpace(repo: PrototypeRepo): Promise<PrototypeRepo | null> {
    const already = selectedSpace.repos.find((item) => item.id === repo.id);
    if (already) return already;
    const next = await applyMutation(
      attachRepositoryToSpace(selectedSpace.id, repo.name, repo.path),
    );
    if (!next) return null;
    const space = next.spaces.find((item) => item.id === selectedSpace.id);
    return (
      space?.repos.find((item) => item.id === repo.id) ??
      space?.repos.find((item) => item.path === repo.path) ??
      null
    );
  }

  async function chooseRepoForNewWorktree(repo: PrototypeRepo, baseWorktree?: string | null) {
    const baseRef = resolveWorktreeBaseRef(repo, baseWorktree, PRIMARY_CHECKOUT);
    const attached = await ensureRepoOnSpace(repo);
    if (!attached) return;
    setGitContext(
      attached.id,
      baseWorktree && baseWorktree !== PRIMARY_CHECKOUT ? baseWorktree : null,
    );
    beginWorktreeForm(attached, baseWorktree, baseRef);
  }

  async function chooseRepoForNewAgent(repo: PrototypeRepo, baseWorktree?: string | null) {
    const baseRef = resolveWorktreeBaseRef(repo, baseWorktree, PRIMARY_CHECKOUT);
    const attached = await ensureRepoOnSpace(repo);
    if (!attached) return;
    setGitContext(
      attached.id,
      baseWorktree && baseWorktree !== PRIMARY_CHECKOUT ? baseWorktree : null,
    );
    setGitPickerOpen(false);
    setAgentDialogBase(baseRef);
    setRequestError(null);
    setAgentDialogOpen(true);
  }

  async function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRepo || !selectedWorktree) {
      setSessionError("Choose a concrete checkout first.");
      return;
    }
    setSessionCreating(true);
    setSessionError(null);
    let pendingSessionId = createdSessionId;
    try {
      if (!pendingSessionId) {
        pendingSessionId = await createProviderSession(
          sessionProvider,
          selectedWorktreePath,
          sessionModelId,
          sessionReasoningEffort,
        );
        setCreatedSessionId(pendingSessionId);
      }
      const next = await claimSession(selectedSpace.id, pendingSessionId);
      commitSpaceState(next.state);
      setCreatedSessionId(null);
      setSessionDialogOpen(false);
      await navigate(`/ses/${encodeURIComponent(pendingSessionId)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create session.";
      setSessionError(
        pendingSessionId
          ? `${message} Retry to attach the existing session without creating another.`
          : message,
      );
    } finally {
      setSessionCreating(false);
    }
  }

  async function importSession(sessionId: string, instanceId?: string) {
    setImportingSessionId(sessionId);
    setImportError(null);
    try {
      const selectedImport = importableSessions.find(
        (session) => session.id === sessionId && session.t3InstanceId === (instanceId ?? null),
      );
      const t3InstanceId = instanceId ?? selectedImport?.t3InstanceId;
      if (t3InstanceId) {
        await importSessionById(sessionId, t3InstanceId);
      }
      const next = await claimSession(selectedSpace.id, sessionId);
      commitSpaceState(next.state);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Unable to import session.");
    } finally {
      setImportingSessionId(null);
    }
  }

  function openSpaceContextMenu(event: ReactMouseEvent<HTMLButtonElement>, spaceId: string) {
    if (window.innerWidth <= 760) return;
    event.preventDefault();
    selectSpace(spaceId);
    setSpaceMenuOpen(false);
    setSessionContextMenu(null);
    setSpaceContextMenu({
      spaceId,
      x: Math.max(10, Math.min(event.clientX, window.innerWidth - 282)),
      y: Math.max(10, Math.min(event.clientY, window.innerHeight - 380)),
      opener: event.currentTarget,
    });
  }

  function openSessionContextMenu(sessionId: string, event: ReactMouseEvent) {
    if (window.innerWidth <= 760) return;
    // Anchor right-clicks stay with the native browser link menu only.
    if (isSessionLinkContextTarget(event.target)) return;
    event.preventDefault();
    setSpaceMenuOpen(false);
    setSpaceContextMenu(null);
    setRepoContextMenu(null);
    setWorktreeContextMenu(null);
    setSessionContextMenu({
      sessionId,
      x: Math.max(10, Math.min(event.clientX, window.innerWidth - 282)),
      y: Math.max(10, Math.min(event.clientY, window.innerHeight - 360)),
    });
  }

  function toggleAttachedSessionPin(sessionId: string) {
    const session =
      selectedSpace.sessions.find((item) => item.id === sessionId) ??
      visibleSessions.find((item) => item.id === sessionId);
    const nextState = nextSessionPinState(session?.state);
    setSessionContextMenu(null);
    spacesFetchGate.begin();
    setPrototype((current) => setPrototypeSessionState(current, sessionId, nextState));
    void (async () => {
      try {
        await setSessionState(sessionId, nextState);
        await reloadSpaces();
      } catch (error) {
        await reloadSpaces({ quiet: true });
        setRequestError(error instanceof Error ? error.message : "Unable to update session pin.");
      }
    })();
  }

  function archiveAttachedSession(sessionId: string) {
    setSessionContextMenu(null);
    // Invalidate in-flight GETs first so a stale roster cannot overwrite optimism.
    spacesFetchGate.begin();
    setPrototype((current) => archivePrototypeSession(current, sessionId));
    void (async () => {
      try {
        await archiveSession(sessionId);
        await reloadSpaces();
      } catch (error) {
        await reloadSpaces({ quiet: true });
        setRequestError(error instanceof Error ? error.message : "Unable to archive session.");
      }
    })();
  }

  function deleteAttachedSession(sessionId: string) {
    const session =
      selectedSpace.sessions.find((item) => item.id === sessionId) ??
      visibleSessions.find((item) => item.id === sessionId);
    const label = session?.title ?? sessionId;
    setSessionContextMenu(null);
    if (
      !window.confirm(
        `Delete session ${label}? This won't delete OpenCode session, so you can open it later, but all Say to Me messages will be gone.`,
      )
    ) {
      return;
    }
    void (async () => {
      try {
        await deleteSession(sessionId);
        await reloadSpaces();
      } catch (error) {
        setRequestError(error instanceof Error ? error.message : "Unable to delete session.");
      }
    })();
  }

  function openCreateSpace() {
    setSpaceName("");
    const parentExists = prototype.spaces.some((space) => space.id === selectedSpace.id);
    setSpaceParentId(parentExists ? selectedSpace.id : null);
    setSpaceContext("");
    setRequestError(null);
    setSpaceForm("create");
    setSpaceMenuOpen(false);
    setSpaceContextMenu(null);
  }

  function openEditSpace() {
    setSpaceName(selectedSpace.name);
    setSpaceParentId(selectedSpace.parentId);
    setSpaceContext(selectedSpace.context);
    setSpaceForm("edit");
    setSpaceMenuOpen(false);
    setSpaceContextMenu(null);
  }

  function openMoveSpace() {
    setMoveSessionId(null);
    setMoveSpaceId(selectedSpace.id);
    setMoveBrowseSpaceId(selectedSpace.parentId);
    setMoveSearch("");
    setMoveSearchIndex(0);
    setSpaceMenuOpen(false);
    setSpaceContextMenu(null);
  }

  function openOrganizeSpaces() {
    // Top-level required; same sibling mechanism works for subspaces when opened from one.
    const parentId = selectedSpace.parentId ?? null;
    setSpaceOrganizeParentId(parentId);
    setSpaceOrganizeOpen(true);
    setSpaceOrganizeDraggingId(null);
    setSpaceMenuOpen(false);
    setSpaceContextMenu(null);
  }

  async function persistSpaceSiblingOrder(orderedIds: string[]) {
    if (orderedIds.length === 0 || spaceOrganizeBusy) return;
    const anchorId = orderedIds[0];
    const snapshotSpaces = prototype.spaces;
    const optimisticSpaces = applySiblingOrderOptimistic(snapshotSpaces, orderedIds);
    setPrototype((current) => ({ ...current, spaces: optimisticSpaces }));
    setSpaceOrganizeBusy(true);
    try {
      const next = await applyMutation(reorderSpaceSiblings(anchorId, orderedIds));
      const spaces = spacesAfterReorderAttempt(snapshotSpaces, optimisticSpaces, Boolean(next));
      if (!next) setPrototype((current) => ({ ...current, spaces }));
    } catch {
      setPrototype((current) => ({ ...current, spaces: snapshotSpaces }));
    } finally {
      setSpaceOrganizeBusy(false);
    }
  }

  function moveOrganizeSpace(spaceId: string, direction: -1 | 1) {
    const siblings = sortSpacesBySortOrder(
      prototype.spaces.filter(
        (space) => !space.archived && (space.parentId ?? null) === spaceOrganizeParentId,
      ),
    );
    const index = siblings.findIndex((space) => space.id === spaceId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    const next = siblings.map((space) => space.id);
    const [removed] = next.splice(index, 1);
    next.splice(target, 0, removed);
    void persistSpaceSiblingOrder(next);
  }

  function dropOrganizeSpace(targetId: string) {
    const draggedId = spaceOrganizeDraggingId;
    setSpaceOrganizeDraggingId(null);
    if (!draggedId || draggedId === targetId) return;
    const siblings = sortSpacesBySortOrder(
      prototype.spaces.filter(
        (space) => !space.archived && (space.parentId ?? null) === spaceOrganizeParentId,
      ),
    );
    const ids = siblings.map((space) => space.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [removed] = next.splice(from, 1);
    next.splice(to, 0, removed);
    void persistSpaceSiblingOrder(next);
  }

  function archiveSelectedSpace() {
    void applyMutation(archiveSpace(selectedSpace.id)).then((next) => {
      if (next)
        void navigate(
          next.selectedSpaceId
            ? `/dashboard/${encodeURIComponent(next.selectedSpaceId)}`
            : "/dashboard",
        );
    });
    setSpaceMenuOpen(false);
    setSpaceContextMenu(null);
  }

  function deleteSelectedSpace() {
    if (window.confirm(`Delete ${selectedSpace.name} and all of its subspaces?`)) {
      void applyMutation(deleteSpace(selectedSpace.id)).then((next) => {
        if (next)
          void navigate(
            next.selectedSpaceId
              ? `/dashboard/${encodeURIComponent(next.selectedSpaceId)}`
              : "/dashboard",
          );
      });
    }
    setSpaceMenuOpen(false);
    setSpaceContextMenu(null);
  }

  function submitSpaceForm() {
    const name = spaceName.trim();
    if (!name) return;
    if (spaceForm === "create") {
      void applyMutation(createSpace(name, spaceContext.trim(), spaceParentId)).then((next) => {
        if (next) void navigate(`/dashboard/${encodeURIComponent(next.selectedSpaceId)}`);
      });
    } else {
      void applyMutation(updateSpace(selectedSpace.id, name, spaceContext.trim(), spaceParentId));
    }
    setSpaceForm(null);
  }

  function openAttachRepository() {
    setCustomRepoName("");
    setCustomRepoPath("");
    setRequestError(null);
    setAttachRepoOpen(true);
  }

  function attachRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const path = customRepoPath.trim();
    const name = customRepoName.trim() || path.split("/").filter(Boolean).at(-1) || "repository";
    if (!path) return;
    void applyMutation(attachRepositoryToSpace(selectedSpace.id, name, path)).then((next) => {
      if (!next) return;
      setAttachRepoOpen(false);
      setSelectedRepoId(null);
      setSelectedWorktreeName(null);
    });
  }

  function openRepoContextMenu(event: ReactMouseEvent<HTMLButtonElement>, repoId: string) {
    if (window.innerWidth <= 760) return;
    event.preventDefault();
    setSelectedRepoId(repoId);
    setSelectedWorktreeName(null);
    setWorktreeContextMenu(null);
    setRepoContextMenu({
      repoId,
      x: Math.max(10, Math.min(event.clientX, window.innerWidth - 245)),
      y: Math.max(10, Math.min(event.clientY, window.innerHeight - 245)),
    });
  }

  function openWorktreeContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    repoId: string,
    worktree: string,
  ) {
    if (window.innerWidth <= 760) return;
    event.preventDefault();
    setSelectedRepoId(repoId);
    setRepoContextMenu(null);
    setWorktreeContextMenu({
      repoId,
      worktree,
      x: Math.max(10, Math.min(event.clientX, window.innerWidth - 245)),
      y: Math.max(10, Math.min(event.clientY, window.innerHeight - 155)),
    });
  }

  function beginWorktreeForm(
    repo: PrototypeRepo,
    baseWorktree?: string | null,
    baseRef?: string | null,
  ) {
    setWorktreeNameDraft("");
    setWorktreeBase(
      baseRef?.trim()
        ? baseRef
        : baseWorktree && baseWorktree !== PRIMARY_CHECKOUT
          ? worktreeBranch(repo, baseWorktree)
          : primaryBranch(repo),
    );
    setWorktreeParentDraft(
      displayLocationPath(preferredWorktreeParent, DEFAULT_WORKTREE_PARENT_PATH),
    );
    setRepoContextMenu(null);
    setWorktreeMenuOpen(false);
    setGitPickerOpen(false);
    setWorktreeFormOpen(true);
  }

  function openWorktreeForm() {
    if (needsRepositoryPickerForWorktree(selectedRepoId) || !selectedRepo) {
      openGitPicker("new-worktree");
      return;
    }
    beginWorktreeForm(selectedRepo, selectedWorktree);
  }

  function submitWorktree(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRepo || !worktreeNameDraft.trim() || !worktreeParentDraft.trim()) return;
    const branch = worktreeNameDraft.trim();
    const name = branch.split("/").filter(Boolean).at(-1) ?? branch;
    void applyMutation(
      createWorktree(
        selectedSpace.id,
        selectedRepo.id,
        branch,
        worktreeBase.trim() || primaryBranch(selectedRepo),
        worktreeParentDraft.trim(),
      ),
    ).then((next) => {
      if (!next) return;
      const nextRepo = next.spaces
        .find((space) => space.id === selectedSpace.id)
        ?.repos.find((repo) => repo.id === selectedRepo.id);
      const createdWorktree = nextRepo
        ? linkedWorktrees(nextRepo).find(
            (worktree) => nextRepo.worktreeBranches?.[worktree] === branch || worktree === name,
          )
        : undefined;
      setGitContext(selectedRepo.id, createdWorktree ?? name);
      setWorktreeFormOpen(false);
    });
  }

  function openEditRepoPath() {
    if (!selectedRepo) return;
    setRepoNameDraft(selectedRepo.name);
    setRepoPathDraft(selectedRepo.path);
    setRepoContextMenu(null);
    setWorktreeMenuOpen(false);
    setEditRepoPathOpen(true);
  }

  function submitRepoPath(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRepo || !repoNameDraft.trim() || !repoPathDraft.trim()) return;
    void applyMutation(
      updateRepository(selectedSpace.id, selectedRepo.id, repoNameDraft, repoPathDraft),
    ).then(() => setEditRepoPathOpen(false));
  }

  function discoverSelectedRepoWorktrees() {
    if (!selectedRepo) return;
    void applyMutation(discoverWorktrees(selectedSpace.id, selectedRepo.id)).then(() => {
      setRepoContextMenu(null);
    });
  }

  function detachSelectedRepo() {
    if (!selectedRepo) return;
    if (window.confirm(`Detach ${selectedRepo.name} from ${selectedSpace.name}?`)) {
      void applyMutation(releaseRepository(selectedSpace.id, selectedRepo.id)).then(() => {
        setSelectedRepoId(null);
        setSelectedWorktreeName(null);
      });
    }
    setRepoContextMenu(null);
  }

  function detachSelectedWorktree() {
    if (!selectedRepo || !selectedWorktree || selectedWorktree === PRIMARY_CHECKOUT) return;
    if (window.confirm(`Detach ${selectedWorktree} from ${selectedSpace.name}?`)) {
      void applyMutation(releaseWorktree(selectedSpace.id, selectedRepo.id, selectedWorktree)).then(
        () => setSelectedWorktreeName(null),
      );
    }
    setWorktreeMenuOpen(false);
  }

  function detachAllWorktrees() {
    if (!selectedRepo || !linkedWorktrees(selectedRepo).length) return;
    if (window.confirm(`Detach all worktrees from ${selectedSpace.name}?`)) {
      void applyMutation(releaseAllWorktrees(selectedSpace.id, selectedRepo.id)).then(() => {
        setSelectedWorktreeName(null);
      });
    }
    setRepoContextMenu(null);
  }

  function detachContextWorktree() {
    if (!worktreeContextMenu || !contextWorktreeRepo) return;
    const { repoId, worktree } = worktreeContextMenu;
    if (window.confirm(`Detach ${worktree} from ${selectedSpace.name}?`)) {
      void applyMutation(releaseWorktree(selectedSpace.id, repoId, worktree)).then(() => {
        if (selectedRepoId === repoId && selectedWorktreeName === worktree) {
          setSelectedWorktreeName(null);
        }
      });
    }
    setWorktreeContextMenu(null);
  }

  if (!loading && prototype.spaces.length === 0) {
    return (
      <div {...stylex.props(chrome.shell)}>
        <Sidebar
          active="spaces"
          initials={profileInitials(profile.name)}
          notifications={notificationChrome}
        />
        <div {...stylex.props(chrome.main)}>
          <div {...stylex.props(explorer.layout)}>
            <aside {...stylex.props(explorer.treePanel)} data-spaces-tree>
              <div {...stylex.props(explorer.treeHeading)}>
                <span {...stylex.props(explorer.eyebrow)}>SPACES</span>
                <button
                  {...stylex.props(explorer.treeAdd)}
                  type="button"
                  aria-label="Create space"
                  onClick={openCreateSpace}
                >
                  <Icon name="plus" /> New space
                </button>
              </div>
              <SpaceTree
                spaces={prototype.spaces}
                parentId={null}
                selectedSpaceId=""
                onSelect={selectSpace}
                onContextMenu={openSpaceContextMenu}
              />
            </aside>
            <section {...stylex.props(explorer.main)}>
              {requestError ? (
                <p {...stylex.props(dialogs.error)} role="alert">
                  {requestError}
                </p>
              ) : (
                <div {...stylex.props(explorer.emptySessions)} role="status">
                  <Icon name="folder" />
                  <strong {...stylex.props(explorer.emptyTitle)}>No spaces yet</strong>
                  <p {...stylex.props(explorer.emptyDetail)}>
                    Create a space to organize repositories, worktrees, and agent sessions.
                  </p>
                  <button
                    {...stylex.props(explorer.actionButton, explorer.primaryAction)}
                    type="button"
                    onClick={openCreateSpace}
                  >
                    <Icon name="plus" /> Create a space
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>
        {spaceForm === "create" ? (
          <div {...stylex.props(dialogs.layer)}>
            <button
              {...stylex.props(dialogs.backdrop)}
              type="button"
              aria-label="Close space dialog"
              onClick={() => setSpaceForm(null)}
            />
            <form
              {...stylex.props(dialogs.formModal)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="empty-space-form-title"
              onSubmit={(event) => {
                event.preventDefault();
                submitSpaceForm();
              }}
            >
              <header {...stylex.props(dialogs.header)}>
                <div>
                  <small {...stylex.props(dialogs.eyebrow)}>NEW SPACE</small>
                  <h2 {...stylex.props(dialogs.title)} id="empty-space-form-title">
                    Create a space
                  </h2>
                </div>
                <button
                  {...stylex.props(dialogs.close)}
                  type="button"
                  aria-label="Close"
                  onClick={() => setSpaceForm(null)}
                >
                  ×
                </button>
              </header>
              <label {...stylex.props(dialogs.label)}>
                <span {...stylex.props(dialogs.labelText)}>NAME</span>
                <input
                  {...stylex.props(dialogs.input)}
                  value={spaceName}
                  onChange={(event) => setSpaceName(event.target.value)}
                  placeholder="Space name"
                  autoFocus
                />
              </label>
              <footer {...stylex.props(dialogs.footer)}>
                <button
                  {...stylex.props(dialogs.button)}
                  type="button"
                  onClick={() => setSpaceForm(null)}
                >
                  Cancel
                </button>
                <button
                  {...stylex.props(
                    dialogs.button,
                    dialogs.primaryButton,
                    !spaceName.trim() && dialogs.disabledButton,
                  )}
                  type="submit"
                  disabled={!spaceName.trim()}
                >
                  Create space
                </button>
              </footer>
            </form>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div {...stylex.props(chrome.shell)}>
      <Sidebar
        active="spaces"
        initials={profileInitials(profile.name)}
        notifications={notificationChrome}
      />
      <div {...stylex.props(chrome.main)}>
        <div {...stylex.props(explorer.layout)}>
          <aside {...stylex.props(explorer.treePanel)} data-spaces-tree>
            <div {...stylex.props(explorer.treeHeading)}>
              <span {...stylex.props(explorer.eyebrow)}>SPACES</span>
              <button
                {...stylex.props(explorer.treeAdd)}
                type="button"
                aria-label="Create space"
                onClick={openCreateSpace}
              >
                <Icon name="plus" /> New space
              </button>
            </div>
            <SpaceTree
              spaces={prototype.spaces}
              parentId={null}
              selectedSpaceId={selectedSpace.id}
              onSelect={selectSpace}
              onContextMenu={openSpaceContextMenu}
            />
            {archivedRoots.length ? (
              <>
                <div {...stylex.props(explorer.divider)} />
                <span {...stylex.props(explorer.eyebrow, explorer.treeSection)}>ARCHIVED</span>
                {archivedRoots.map((space) => (
                  <button
                    {...stylex.props(explorer.archivedRow)}
                    key={space.id}
                    type="button"
                    onClick={() => void applyMutation(restoreSpace(space.id))}
                  >
                    <span {...stylex.props(explorer.treeRowIcon)}>
                      <Icon name="folder" />
                    </span>
                    <span>{space.name}</span>
                    <small {...stylex.props(explorer.archivedRestore)}>Restore</small>
                  </button>
                ))}
              </>
            ) : null}
          </aside>

          <section {...stylex.props(explorer.main)}>
            {loading ? <p role="status">Loading spaces…</p> : null}
            {requestError ? (
              <p {...stylex.props(dialogs.error)} role="alert">
                {requestError}
              </p>
            ) : null}
            <DashboardSpaceHeader
              space={selectedSpace}
              parentName={selectedParentName}
              parentSpaceId={selectedParent?.id}
              repoName={
                allGitContexts
                  ? includeSubspaces
                    ? `Everything in ${selectedSpace.name}`
                    : "All git contexts"
                  : (selectedRepo?.name ?? "No repository")
              }
              worktreeName={
                allGitContexts
                  ? `${visibleSessions.length} sessions`
                  : selectedWorktree === PRIMARY_CHECKOUT
                    ? "Primary checkout"
                    : (selectedWorktree ?? "All worktrees")
              }
              menuOpen={spaceMenuOpen}
              onToggleMenu={() => setSpaceMenuOpen((open) => !open)}
              onOpenNavigator={openSpaceNavigator}
              onOpenGitPicker={() => openGitPicker("browse")}
              onSelectSpace={selectSpace}
              onCreateJarvis={openCreateJarvis}
              createJarvisDisabled={
                selectedSpace.id === "loading" ||
                !prototype.spaces.some((space) => space.id === selectedSpace.id)
              }
              onOrganize={openOrganizeSpaces}
              onEdit={openEditSpace}
              onMove={openMoveSpace}
              onArchive={archiveSelectedSpace}
              onDelete={deleteSelectedSpace}
            />
            <div {...stylex.props(explorer.mobileActions)}>
              <button
                {...stylex.props(explorer.mobileNavigator)}
                type="button"
                onClick={openSpaceNavigator}
              >
                <Icon name="folder" /> Open space navigator
              </button>
            </div>
            {allGitContexts ? (
              <div {...stylex.props(explorer.worktreeHero)}>
                <div {...stylex.props(explorer.branchBadge)}>
                  <Icon name="session" />
                </div>
                <div>
                  <small {...stylex.props(explorer.worktreeLabel)}>SPACE ACTIVITY</small>
                  <h1 {...stylex.props(explorer.worktreeTitle)}>All sessions</h1>
                  <p {...stylex.props(explorer.worktreeDescription)}>
                    {includeSubspaces
                      ? `Every agent session in ${selectedSpace.name} and its ${descendantCount} subspace${descendantCount === 1 ? "" : "s"}.`
                      : `Every agent session directly assigned to ${selectedSpace.name}, across all repositories and checkouts.`}
                  </p>
                </div>
                <Status>{visibleSessions.length} total</Status>
              </div>
            ) : (
              <>
                <div {...stylex.props(explorer.worktreeHero)}>
                  <div {...stylex.props(explorer.branchBadge)}>
                    <Icon name="branch" />
                  </div>
                  <div>
                    <small {...stylex.props(explorer.worktreeLabel)}>
                      {selectedWorktree === PRIMARY_CHECKOUT
                        ? "PRIMARY CHECKOUT"
                        : selectedWorktree
                          ? "LINKED WORKTREE"
                          : "REPOSITORY"}
                    </small>
                    <h1 {...stylex.props(explorer.worktreeTitle)}>
                      {selectedCheckoutLabel ?? "All checkouts"}
                    </h1>
                    <p {...stylex.props(explorer.worktreeDescription)}>
                      {selectedBranch ? `Branch: ${selectedBranch}` : selectedSpace.context}
                    </p>
                  </div>
                  <Status>clean</Status>
                  <div {...stylex.props(explorer.gitMenuWrap)} data-worktree-menu>
                    <button
                      {...stylex.props(explorer.worktreeMenu)}
                      type="button"
                      aria-label="Worktree actions"
                      aria-expanded={worktreeMenuOpen}
                      onClick={() => setWorktreeMenuOpen((open) => !open)}
                    >
                      <Icon name="more" />
                    </button>
                    {worktreeMenuOpen ? (
                      <div {...stylex.props(explorer.gitMenu)} role="menu">
                        <button
                          {...stylex.props(explorer.gitMenuItem)}
                          type="button"
                          role="menuitem"
                          onClick={openWorktreeForm}
                        >
                          <Icon name="branch" />
                          <span>New worktree</span>
                        </button>
                        <button
                          {...stylex.props(explorer.gitMenuItem)}
                          type="button"
                          role="menuitem"
                          onClick={openEditRepoPath}
                        >
                          <Icon name="repo" />
                          <span>Edit repository</span>
                        </button>
                        <button
                          {...stylex.props(explorer.gitMenuItem, explorer.gitMenuDanger)}
                          type="button"
                          role="menuitem"
                          disabled={!selectedWorktree || selectedWorktree === PRIMARY_CHECKOUT}
                          onClick={detachSelectedWorktree}
                        >
                          <span>×</span>
                          <span>Detach worktree</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div {...stylex.props(explorer.pathCard)}>
                  <div {...stylex.props(explorer.pathDetails)}>
                    <small {...stylex.props(explorer.pathLabel)}>LOCAL PATH</small>
                    <code {...stylex.props(explorer.pathCode)}>{selectedWorktreePath}</code>
                  </div>
                  <button {...stylex.props(explorer.pathButton)} type="button">
                    Open folder ↗
                  </button>
                  <button {...stylex.props(explorer.pathButton)} type="button">
                    Copy
                  </button>
                </div>
              </>
            )}
            <div {...stylex.props(explorer.actions)}>
              <button
                {...stylex.props(explorer.actionButton, explorer.primaryAction)}
                type="button"
                onClick={(event) => openAgentDialog(event.currentTarget)}
              >
                <Icon name="plus" /> {agentCreateButtonLabel(selectedRepoId)}
              </button>
              <button
                {...stylex.props(explorer.actionButton)}
                type="button"
                onClick={openSessionDialog}
              >
                <Icon name="plus" />{" "}
                {!selectedRepo || !selectedWorktree
                  ? "Choose context for new session"
                  : "New session here"}
              </button>
              <button
                {...stylex.props(explorer.actionButton)}
                type="button"
                onClick={openImportDialog}
              >
                <Icon name="session" /> Import session
                {selectedRepo && selectedWorktree && importableSessions.length
                  ? ` (${importableSessions.length})`
                  : ""}
              </button>
              <button
                {...stylex.props(explorer.actionButton)}
                type="button"
                onClick={openWorktreeForm}
              >
                <Icon name="branch" /> {worktreeCreateButtonLabel(selectedRepoId)}
              </button>
            </div>

            <div {...stylex.props(explorer.sessionSection)}>
              <SpaceSessionRoster
                spaceName={selectedSpace.name}
                sessions={visibleSessions}
                loading={loading}
                error={requestError}
                includeSubspaces={includeSubspaces}
                onViewHistory={() => setHistoryOpen(true)}
                historyButtonRef={historyButtonRef}
                onRetry={() => {
                  setLoading(true);
                  void reloadSpaces()
                    .catch(() => undefined)
                    .finally(() => setLoading(false));
                }}
                onCreateSession={() => {
                  if (allGitContexts) openGitPicker("new-session");
                  else openSessionDialog();
                }}
                onImportSession={() => {
                  if (allGitContexts) openGitPicker("import");
                  else setImportDialogOpen(true);
                }}
                onMoveSession={(sessionId) => {
                  setSessionContextMenu(null);
                  setMoveSpaceId(null);
                  setMoveSessionId(sessionId);
                  setMoveBrowseSpaceId(selectedSpace.id);
                  setMoveSearch("");
                  setMoveSearchIndex(0);
                }}
                onReleaseSession={(sessionId) => {
                  setSessionContextMenu(null);
                  void applyMutation(releaseSession(selectedSpace.id, sessionId));
                }}
                onArchiveSession={archiveAttachedSession}
                onDeleteSession={deleteAttachedSession}
                onSessionContextMenu={openSessionContextMenu}
              />
            </div>
          </section>

          <aside {...stylex.props(explorer.contextPanel)}>
            <div {...stylex.props(explorer.contextHeading)}>
              <small {...stylex.props(explorer.contextLabel)}>SPACE CONTEXT</small>
              <div {...stylex.props(explorer.contextActions)}>
                <button
                  {...stylex.props(explorer.contextEdit)}
                  type="button"
                  onClick={openEditSpace}
                >
                  Edit
                </button>
                <SpaceActionsTrigger
                  title={selectedSpace.name}
                  open={spaceMenuOpen}
                  compact
                  onToggle={() => setSpaceMenuOpen((open) => !open)}
                  onCreateJarvis={openCreateJarvis}
                  createJarvisDisabled={
                    selectedSpace.id === "loading" ||
                    !prototype.spaces.some((space) => space.id === selectedSpace.id)
                  }
                  onOrganize={openOrganizeSpaces}
                  onEdit={openEditSpace}
                  onMove={openMoveSpace}
                  onArchive={archiveSelectedSpace}
                  onDelete={deleteSelectedSpace}
                />
              </div>
            </div>
            <p {...stylex.props(explorer.contextDescription)}>{selectedSpace.context}</p>
            <div {...stylex.props(explorer.contextBlock)}>
              <span {...stylex.props(explorer.contextBlockLabel)}>DEFAULT MODEL</span>
              <strong {...stylex.props(explorer.contextBlockTitle)}>GPT-5.6</strong>
              <small {...stylex.props(explorer.contextBlockDetail)}>OpenCode</small>
            </div>
            <div {...stylex.props(explorer.contextBlock)}>
              <span {...stylex.props(explorer.contextBlockLabel)}>SESSIONS</span>
              <strong {...stylex.props(explorer.contextBlockTitle)}>
                {visibleSessions.length} attached
              </strong>
              <small {...stylex.props(explorer.contextBlockDetail)}>
                Session ownership is managed by import and release.
              </small>
            </div>
            <div {...stylex.props(explorer.contextBlock)}>
              <span {...stylex.props(explorer.contextBlockLabel)}>INHERITED FROM</span>
              <strong {...stylex.props(explorer.contextBlockTitle)}>
                {selectedSpace.parentId
                  ? prototype.spaces.find((space) => space.id === selectedSpace.parentId)?.name
                  : "No parent space"}
              </strong>
              <small {...stylex.props(explorer.contextBlockDetail)}>
                Context v4 · refreshed today
              </small>
            </div>
            <div {...stylex.props(explorer.importNote)}>
              <Icon name="bell" />
              <p {...stylex.props(explorer.importNoteText)}>
                <strong {...stylex.props(explorer.importNoteTitle)}>Import protection</strong>If a
                session already belongs elsewhere, choose to link it here or move its home.
              </p>
            </div>
          </aside>
        </div>
      </div>
      {repoContextMenu && contextRepo ? (
        <div
          {...stylex.props(menu.popup, menu.contextPopup)}
          data-repo-context-menu
          role="menu"
          style={{ left: repoContextMenu.x, top: repoContextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div {...stylex.props(menu.heading)}>
            <span {...stylex.props(menu.headingLabel)}>REPOSITORY</span>
            <strong {...stylex.props(menu.headingTitle)}>{contextRepo.name}</strong>
          </div>
          <button
            {...stylex.props(menu.item)}
            type="button"
            role="menuitem"
            onClick={openWorktreeForm}
          >
            <span {...stylex.props(menu.itemIcon)}>
              <Icon name="branch" />
            </span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>New worktree</strong>
              <small {...stylex.props(menu.itemDetail)}>Add a local branch checkout</small>
            </span>
          </button>
          <button
            {...stylex.props(menu.item)}
            type="button"
            role="menuitem"
            onClick={openEditRepoPath}
          >
            <span {...stylex.props(menu.itemIcon)}>
              <Icon name="repo" />
            </span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>Edit repository</strong>
              <small {...stylex.props(menu.itemDetail)}>Update its name or local path</small>
            </span>
          </button>
          <button
            {...stylex.props(menu.item)}
            type="button"
            role="menuitem"
            onClick={discoverSelectedRepoWorktrees}
          >
            <span {...stylex.props(menu.itemIcon)}>
              <Icon name="branch" />
            </span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>Discover worktrees</strong>
              <small {...stylex.props(menu.itemDetail)}>Find all local Git checkouts</small>
            </span>
          </button>
          {linkedWorktrees(contextRepo).length ? (
            <button
              {...stylex.props(menu.item, menu.danger)}
              type="button"
              role="menuitem"
              onClick={detachAllWorktrees}
            >
              <span {...stylex.props(menu.dangerIcon)}>×</span>
              <span {...stylex.props(menu.itemText)}>
                <strong {...stylex.props(menu.itemTitle)}>Detach all worktrees</strong>
                <small {...stylex.props(menu.itemDetail)}>Keep checkouts on disk</small>
              </span>
            </button>
          ) : null}
          <button
            {...stylex.props(menu.item, menu.danger)}
            type="button"
            role="menuitem"
            onClick={detachSelectedRepo}
          >
            <span {...stylex.props(menu.dangerIcon)}>×</span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>Detach repository</strong>
              <small {...stylex.props(menu.itemDetail)}>Keep files on disk</small>
            </span>
          </button>
        </div>
      ) : null}
      {worktreeContextMenu && contextWorktreeRepo ? (
        <div
          {...stylex.props(menu.popup, menu.contextPopup)}
          data-worktree-context-menu
          role="menu"
          style={{ left: worktreeContextMenu.x, top: worktreeContextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div {...stylex.props(menu.heading)}>
            <span {...stylex.props(menu.headingLabel)}>WORKTREE</span>
            <strong {...stylex.props(menu.headingTitle)}>{worktreeContextMenu.worktree}</strong>
            <small {...stylex.props(menu.itemDetail)}>{contextWorktreeRepo.name}</small>
          </div>
          <button
            {...stylex.props(menu.item, menu.danger)}
            type="button"
            role="menuitem"
            onClick={detachContextWorktree}
          >
            <span {...stylex.props(menu.dangerIcon)}>×</span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>Detach worktree</strong>
              <small {...stylex.props(menu.itemDetail)}>Keep checkout on disk</small>
            </span>
          </button>
        </div>
      ) : null}
      {sessionContextMenu && contextSession ? (
        <div
          {...stylex.props(menu.popup, menu.contextPopup)}
          data-session-context-menu
          role="menu"
          style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div {...stylex.props(menu.heading)}>
            <span {...stylex.props(menu.headingLabel)}>SESSION</span>
            <strong {...stylex.props(menu.headingTitle)}>{contextSession.title}</strong>
          </div>
          <button
            {...stylex.props(menu.item)}
            type="button"
            role="menuitem"
            onClick={() => toggleAttachedSessionPin(contextSession.id)}
          >
            <span {...stylex.props(menu.itemIcon)}>
              <Icon name="session" />
            </span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>
                {sessionPinActionLabel(contextSession.state)}
              </strong>
              <small {...stylex.props(menu.itemDetail)}>
                {contextSession.state === "important"
                  ? "Remove from Important on Home"
                  : "Shows in Important on Home"}
              </small>
            </span>
          </button>
          <button
            {...stylex.props(menu.item)}
            type="button"
            role="menuitem"
            onClick={() => {
              setSessionContextMenu(null);
              setMoveSpaceId(null);
              setMoveSessionId(contextSession.id);
              setMoveBrowseSpaceId(selectedSpace.id);
              setMoveSearch("");
              setMoveSearchIndex(0);
            }}
          >
            <span {...stylex.props(menu.itemIcon)}>
              <Icon name="folder" />
            </span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>Move</strong>
              <small {...stylex.props(menu.itemDetail)}>Change this session's home space</small>
            </span>
          </button>
          <button
            {...stylex.props(menu.item)}
            type="button"
            role="menuitem"
            onClick={() => {
              setSessionContextMenu(null);
              void applyMutation(releaseSession(selectedSpace.id, contextSession.id));
            }}
          >
            <span {...stylex.props(menu.itemIcon)}>
              <Icon name="session" />
            </span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>Release from space</strong>
              <small {...stylex.props(menu.itemDetail)}>Keep the session, detach ownership</small>
            </span>
          </button>
          <button
            {...stylex.props(menu.item)}
            type="button"
            role="menuitem"
            onClick={() => archiveAttachedSession(contextSession.id)}
          >
            <span {...stylex.props(menu.itemIcon)}>
              <Icon name="folder" />
            </span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>Archive</strong>
              <small {...stylex.props(menu.itemDetail)}>Hide from the active session list</small>
            </span>
          </button>
          <button
            {...stylex.props(menu.item, menu.danger)}
            type="button"
            role="menuitem"
            onClick={() => deleteAttachedSession(contextSession.id)}
          >
            <span {...stylex.props(menu.dangerIcon)}>×</span>
            <span {...stylex.props(menu.itemText)}>
              <strong {...stylex.props(menu.itemTitle)}>Delete</strong>
              <small {...stylex.props(menu.itemDetail)}>Remove Say messages for this session</small>
            </span>
          </button>
        </div>
      ) : null}
      {spaceContextMenu ? (
        <div
          {...stylex.props(menu.popup, menu.contextPopup)}
          data-space-context-menu
          role="menu"
          style={{ left: spaceContextMenu.x, top: spaceContextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <SpaceMenuContent
            title={selectedSpace.name}
            onCreateJarvis={() => openCreateJarvis(spaceContextMenu.opener)}
            createJarvisDisabled={
              selectedSpace.id === "loading" ||
              !prototype.spaces.some((space) => space.id === selectedSpace.id)
            }
            onOrganize={openOrganizeSpaces}
            onEdit={openEditSpace}
            onMove={openMoveSpace}
            onArchive={archiveSelectedSpace}
            onDelete={deleteSelectedSpace}
          />
        </div>
      ) : null}
      {spaceOrganizeOpen ? (
        <div {...stylex.props(dialogs.layer)} data-space-organize>
          <button
            {...stylex.props(dialogs.backdrop)}
            type="button"
            aria-label="Close organize spaces"
            onClick={() => setSpaceOrganizeOpen(false)}
          />
          <section
            {...stylex.props(dialogs.pickerModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="space-organize-title"
          >
            <header {...stylex.props(dialogs.header)}>
              <div>
                <small {...stylex.props(dialogs.eyebrow)}>SPACES</small>
                <h2 {...stylex.props(dialogs.title)} id="space-organize-title">
                  Organize
                </h2>
                <p {...stylex.props(dialogs.pickerPath)}>
                  {spaceOrganizeParentId
                    ? `Reorder subspaces under ${prototype.spaces.find((space) => space.id === spaceOrganizeParentId)?.name ?? "parent"}`
                    : "Drag or use Up/Down to reorder top-level spaces"}
                </p>
              </div>
              <button
                {...stylex.props(dialogs.close)}
                type="button"
                aria-label="Close"
                onClick={() => setSpaceOrganizeOpen(false)}
              >
                ×
              </button>
            </header>
            <div {...stylex.props(dialogs.pickerList)} role="list">
              {sortSpacesBySortOrder(
                prototype.spaces.filter(
                  (space) => !space.archived && (space.parentId ?? null) === spaceOrganizeParentId,
                ),
              ).map((space, index, list) => (
                <div
                  key={space.id}
                  {...stylex.props(dialogs.pickerRow)}
                  role="listitem"
                  draggable={!spaceOrganizeBusy}
                  onDragStart={() => setSpaceOrganizeDraggingId(space.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dropOrganizeSpace(space.id)}
                  data-space-organize-row={space.id}
                  style={{
                    opacity: spaceOrganizeDraggingId === space.id ? 0.55 : 1,
                    cursor: spaceOrganizeBusy ? "wait" : "grab",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span {...stylex.props(dialogs.pickerIcon)} aria-hidden="true">
                    <Icon name="folder" />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong {...stylex.props(dialogs.pickerTitle)}>{space.name}</strong>
                    <small {...stylex.props(dialogs.pickerPath)}>
                      {index + 1} of {list.length}
                    </small>
                  </span>
                  <button
                    {...stylex.props(dialogs.button)}
                    type="button"
                    aria-label={`Move ${space.name} up`}
                    disabled={spaceOrganizeBusy || index === 0}
                    onClick={() => moveOrganizeSpace(space.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    {...stylex.props(dialogs.button)}
                    type="button"
                    aria-label={`Move ${space.name} down`}
                    disabled={spaceOrganizeBusy || index === list.length - 1}
                    onClick={() => moveOrganizeSpace(space.id, 1)}
                  >
                    ↓
                  </button>
                </div>
              ))}
            </div>
            <footer {...stylex.props(dialogs.pickerFooter)}>
              <button
                {...stylex.props(dialogs.button)}
                type="button"
                onClick={() => setSpaceOrganizeOpen(false)}
              >
                Done
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {spacePickerOpen ? (
        <div {...stylex.props(dialogs.layer)}>
          <button
            {...stylex.props(dialogs.backdrop)}
            type="button"
            aria-label="Close space picker"
            onClick={() => setSpacePickerOpen(false)}
          />
          <section
            {...stylex.props(dialogs.pickerModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="space-picker-title"
          >
            <header {...stylex.props(dialogs.header)}>
              <div>
                <small {...stylex.props(dialogs.eyebrow)}>SPACES</small>
                <h2 {...stylex.props(dialogs.title)} id="space-picker-title">
                  Switch space
                </h2>
              </div>
              <button
                {...stylex.props(dialogs.close)}
                type="button"
                aria-label="Close"
                onClick={() => setSpacePickerOpen(false)}
              >
                ×
              </button>
            </header>
            <div {...stylex.props(dialogs.searchField, dialogs.pickerSearch)}>
              <span {...stylex.props(dialogs.searchIcon)}>
                <Icon name="search" />
              </span>
              <input
                {...stylex.props(dialogs.searchInput)}
                autoFocus
                role="combobox"
                aria-autocomplete="list"
                aria-controls="space-picker-results"
                aria-expanded="true"
                aria-activedescendant={
                  spacePickerResults[spacePickerIndex]
                    ? `space-picker-result-${spacePickerResults[spacePickerIndex].space.id}`
                    : undefined
                }
                placeholder="Search spaces"
                value={spacePickerSearch}
                onChange={(event) => {
                  setSpacePickerSearch(event.target.value);
                  setSpacePickerIndex(0);
                }}
                onKeyDown={(event) => {
                  if (!spacePickerResults.length) return;
                  let nextIndex = spacePickerIndex;
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    nextIndex = (spacePickerIndex + 1) % spacePickerResults.length;
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    nextIndex =
                      (spacePickerIndex - 1 + spacePickerResults.length) %
                      spacePickerResults.length;
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    selectSpace(spacePickerResults[spacePickerIndex].space.id);
                    return;
                  } else {
                    return;
                  }
                  setSpacePickerIndex(nextIndex);
                  requestAnimationFrame(() =>
                    document
                      .getElementById(
                        `space-picker-result-${spacePickerResults[nextIndex].space.id}`,
                      )
                      ?.scrollIntoView({ block: "nearest" }),
                  );
                }}
              />
              {spacePickerSearch ? (
                <button
                  {...stylex.props(dialogs.clearSearch)}
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setSpacePickerSearch("");
                    setSpacePickerIndex(0);
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
            <div {...stylex.props(dialogs.pickerList)} id="space-picker-results" role="listbox">
              {spacePickerResults.length ? (
                spacePickerResults.map(({ space, path }, index) => (
                  <button
                    {...stylex.props(
                      dialogs.pickerRow,
                      index === spacePickerIndex && dialogs.pickerRowActive,
                    )}
                    id={`space-picker-result-${space.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === spacePickerIndex}
                    key={space.id}
                    onMouseEnter={() => setSpacePickerIndex(index)}
                    onClick={() => selectSpace(space.id)}
                  >
                    <span {...stylex.props(dialogs.pickerIcon)}>
                      <Icon name="folder" />
                    </span>
                    <span>
                      <strong {...stylex.props(dialogs.pickerTitle)}>{space.name}</strong>
                      <small {...stylex.props(dialogs.pickerPath)}>{path}</small>
                    </span>
                    {space.id === selectedSpace.id ? (
                      <em {...stylex.props(dialogs.currentBadge)}>Current</em>
                    ) : null}
                  </button>
                ))
              ) : (
                <div {...stylex.props(dialogs.noResults)}>No matching spaces</div>
              )}
            </div>
            <footer {...stylex.props(dialogs.pickerFooter)}>
              <button
                {...stylex.props(dialogs.button)}
                type="button"
                onClick={() => {
                  setSpacePickerOpen(false);
                  openCreateSpace();
                }}
              >
                <Icon name="plus" /> New space
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {gitPickerOpen ? (
        <div {...stylex.props(dialogs.layer)}>
          <button
            {...stylex.props(dialogs.backdrop)}
            type="button"
            aria-label="Close repository picker"
            onClick={() => setGitPickerOpen(false)}
          />
          <section
            {...stylex.props(dialogs.pickerModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="git-picker-title"
          >
            <header {...stylex.props(dialogs.header)}>
              <div>
                <small {...stylex.props(dialogs.eyebrow)}>
                  {gitPickerEyebrow(gitPickerPurpose)}
                </small>
                <h2 {...stylex.props(dialogs.title)} id="git-picker-title">
                  {gitPickerTitle(gitPickerPurpose)}
                </h2>
              </div>
              <button
                {...stylex.props(dialogs.close)}
                type="button"
                aria-label="Close"
                onClick={() => setGitPickerOpen(false)}
              >
                ×
              </button>
            </header>
            <div {...stylex.props(dialogs.searchField, dialogs.pickerSearch)}>
              <span {...stylex.props(dialogs.searchIcon)}>
                <Icon name="search" />
              </span>
              <input
                {...stylex.props(dialogs.searchInput)}
                autoFocus
                placeholder="Search repositories and worktrees"
                value={gitPickerSearch}
                onChange={(event) => setGitPickerSearch(event.target.value)}
              />
              {gitPickerSearch ? (
                <button
                  {...stylex.props(dialogs.clearSearch)}
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setGitPickerSearch("")}
                >
                  ×
                </button>
              ) : null}
            </div>
            <div {...stylex.props(dialogs.pickerList, dialogs.gitPickerList)}>
              {gitPickerPurpose === "browse" && showAllGitOption ? (
                <button
                  {...stylex.props(
                    dialogs.pickerRow,
                    allGitContexts && !includeSubspaces && dialogs.pickerRowSelected,
                  )}
                  type="button"
                  onClick={() => {
                    setGitContext(null, null);
                    setGitPickerOpen(false);
                  }}
                >
                  <span {...stylex.props(dialogs.pickerIcon)}>
                    <Icon name="session" />
                  </span>
                  <span>
                    <strong {...stylex.props(dialogs.pickerTitle)}>This space</strong>
                    <small {...stylex.props(dialogs.pickerPath)}>
                      All sessions across every Git context
                    </small>
                  </span>
                  {allGitContexts && !includeSubspaces ? (
                    <em {...stylex.props(dialogs.currentBadge)}>Current</em>
                  ) : null}
                </button>
              ) : null}
              {gitPickerPurpose === "browse" && showSubspacesOption ? (
                <button
                  {...stylex.props(
                    dialogs.pickerRow,
                    allGitContexts && includeSubspaces && dialogs.pickerRowSelected,
                  )}
                  type="button"
                  onClick={() => {
                    setGitContext(null, null);
                    setIncludeSubspaces(true);
                    setGitPickerOpen(false);
                  }}
                >
                  <span {...stylex.props(dialogs.pickerIcon)}>
                    <Icon name="folder" />
                  </span>
                  <span>
                    <strong {...stylex.props(dialogs.pickerTitle)}>
                      Everything in {selectedSpace.name}
                    </strong>
                    <small {...stylex.props(dialogs.pickerPath)}>
                      Includes {descendantCount} subspace{descendantCount === 1 ? "" : "s"}
                    </small>
                  </span>
                  {allGitContexts && includeSubspaces ? (
                    <em {...stylex.props(dialogs.currentBadge)}>Current</em>
                  ) : null}
                </button>
              ) : null}
              {gitPickerResults.length ? (
                gitPickerResults.map((repo) => {
                  const repoMatches = repo.name
                    .toLocaleLowerCase()
                    .includes(normalizedGitPickerSearch);
                  const showPrimaryCheckout =
                    !normalizedGitPickerSearch ||
                    repoMatches ||
                    "primary checkout".includes(normalizedGitPickerSearch) ||
                    primaryBranch(repo).toLocaleLowerCase().includes(normalizedGitPickerSearch);
                  const visibleWorktrees = linkedWorktrees(repo).filter(
                    (worktree) =>
                      !normalizedGitPickerSearch ||
                      repoMatches ||
                      worktree.toLocaleLowerCase().includes(normalizedGitPickerSearch) ||
                      worktreeBranch(repo, worktree)
                        .toLocaleLowerCase()
                        .includes(normalizedGitPickerSearch),
                  );
                  return (
                    <section {...stylex.props(dialogs.gitGroup)} key={repo.id}>
                      <button
                        {...stylex.props(dialogs.gitRepoRow)}
                        type="button"
                        onContextMenu={(event) => openRepoContextMenu(event, repo.id)}
                        onClick={() => {
                          if (gitPickerPurpose === "new-worktree") {
                            void chooseRepoForNewWorktree(repo, null);
                            return;
                          }
                          if (gitPickerPurpose === "new-agent") {
                            void chooseRepoForNewAgent(repo, null);
                            return;
                          }
                          setGitContext(repo.id, null);
                          if (gitPickerPurpose === "browse") setGitPickerOpen(false);
                        }}
                      >
                        <span {...stylex.props(dialogs.pickerIcon)}>
                          <Icon name="repo" />
                        </span>
                        <strong>{repo.name}</strong>
                      </button>
                      {showPrimaryCheckout ? (
                        <button
                          {...stylex.props(
                            dialogs.gitWorktreeRow,
                            repo.id === selectedRepo?.id &&
                              selectedWorktree === PRIMARY_CHECKOUT &&
                              dialogs.pickerRowSelected,
                          )}
                          type="button"
                          onClick={() => {
                            chooseGitContext(repo.id, PRIMARY_CHECKOUT);
                          }}
                        >
                          <span {...stylex.props(dialogs.pickerIcon)}>
                            <Icon name="folder" />
                          </span>
                          <span>
                            <strong {...stylex.props(dialogs.pickerTitle)}>Primary checkout</strong>
                            <small {...stylex.props(dialogs.pickerPath)}>
                              Branch: {primaryBranch(repo)}
                            </small>
                          </span>
                          <em {...stylex.props(dialogs.checkoutBadge)}>PRIMARY</em>
                        </button>
                      ) : null}
                      {visibleWorktrees.map((worktree) => (
                        <button
                          {...stylex.props(
                            dialogs.gitWorktreeRow,
                            repo.id === selectedRepo?.id &&
                              worktree === selectedWorktree &&
                              dialogs.pickerRowSelected,
                          )}
                          type="button"
                          key={worktree}
                          onContextMenu={(event) =>
                            openWorktreeContextMenu(event, repo.id, worktree)
                          }
                          onClick={() => {
                            chooseGitContext(repo.id, worktree);
                          }}
                        >
                          <span {...stylex.props(dialogs.pickerIcon)}>
                            <Icon name="branch" />
                          </span>
                          <span>
                            <strong {...stylex.props(dialogs.pickerTitle)}>{worktree}</strong>
                            <small {...stylex.props(dialogs.pickerPath)}>
                              Branch: {worktreeBranch(repo, worktree)}
                            </small>
                          </span>
                          {repo.id === selectedRepo?.id && worktree === selectedWorktree ? (
                            <em {...stylex.props(dialogs.currentBadge)}>Current</em>
                          ) : null}
                        </button>
                      ))}
                      {(repo.availableWorktrees ?? []).map((worktree) => (
                        <button
                          {...stylex.props(dialogs.gitWorktreeRow)}
                          type="button"
                          key={`available-${worktree}`}
                          onClick={() => {
                            if (gitPickerPurpose === "new-worktree") {
                              void chooseRepoForNewWorktree(repo, worktree);
                              return;
                            }
                            void applyMutation(
                              claimWorktree(selectedSpace.id, repo.id, worktree),
                            ).then((next) => {
                              if (!next) return;
                              chooseGitContext(repo.id, worktree);
                            });
                          }}
                        >
                          <span {...stylex.props(dialogs.pickerIcon)}>
                            <Icon name="branch" />
                          </span>
                          <span>
                            <strong {...stylex.props(dialogs.pickerTitle)}>{worktree}</strong>
                            <small {...stylex.props(dialogs.pickerPath)}>
                              Branch: {availableWorktreeBranch(repo, worktree)} · Available to claim
                            </small>
                          </span>
                        </button>
                      ))}
                    </section>
                  );
                })
              ) : gitPickerPurpose === "new-worktree" &&
                !normalizedGitPickerSearch &&
                knownRepos.length === 0 ? (
                <div {...stylex.props(dialogs.noResults)}>
                  <p>
                    {gitPickerEmptyMessage({
                      purpose: "new-worktree",
                      hasSearch: false,
                      knownRepoCount: 0,
                    })}
                  </p>
                  <button
                    {...stylex.props(dialogs.button)}
                    type="button"
                    onClick={() => {
                      setGitPickerOpen(false);
                      openAttachRepository();
                    }}
                  >
                    <Icon name="plus" /> Attach repository
                  </button>
                </div>
              ) : gitPickerPurpose !== "browse" || (!showAllGitOption && !showSubspacesOption) ? (
                <div {...stylex.props(dialogs.noResults)}>
                  {gitPickerEmptyMessage({
                    purpose: gitPickerPurpose,
                    hasSearch: Boolean(normalizedGitPickerSearch),
                    knownRepoCount: knownRepos.length,
                  })}
                </div>
              ) : null}
            </div>
            {shouldShowAttachRepositoryInGitPicker(gitPickerPurpose) ? (
              <footer
                {...stylex.props(
                  dialogs.pickerFooter,
                  gitPickerPurpose === "browse" && dialogs.pickerFooterSplit,
                )}
              >
                <button
                  {...stylex.props(dialogs.button)}
                  type="button"
                  onClick={() => {
                    setGitPickerOpen(false);
                    openAttachRepository();
                  }}
                >
                  <Icon name="plus" /> Attach repository
                </button>
                {gitPickerPurpose === "browse" ? (
                  <button
                    {...stylex.props(
                      dialogs.button,
                      (allGitContexts || !selectedRepo) && dialogs.disabledButton,
                    )}
                    type="button"
                    disabled={allGitContexts || !selectedRepo}
                    onClick={() => {
                      setGitPickerOpen(false);
                      openWorktreeForm();
                    }}
                  >
                    <Icon name="branch" /> New worktree
                  </button>
                ) : null}
              </footer>
            ) : null}
          </section>
        </div>
      ) : null}
      {createJarvisOpen && selectedSpace.id !== "loading" ? (
        <CreateJarvisDialog
          spaceId={selectedSpace.id}
          spaceName={selectedSpace.name}
          defaultProvider={selectedSpace.defaultProvider}
          defaultModel={selectedSpace.defaultModel}
          returnFocusTo={createJarvisOpenerRef.current}
          onBusyChange={setCreateJarvisBusy}
          onClose={() => {
            if (!createJarvisBusy) setCreateJarvisOpen(false);
          }}
          onCreated={({ state, sessionId, bootstrapStatus, bootstrapError }) => {
            commitSpaceState(state);
            setCreateJarvisOpen(false);
            setCreateJarvisBusy(false);
            if (bootstrapStatus === "failed") {
              setRequestError(
                bootstrapError || "Jarvis was created, but bootstrap delivery failed.",
              );
              return;
            }
            void navigate(`/ses/${encodeURIComponent(sessionId)}`);
          }}
        />
      ) : null}
      {agentDialogOpen && selectedRepo && selectedSpace.id !== "loading" ? (
        <CreateAgentWorktreeDialog
          spaceId={selectedSpace.id}
          spaceName={selectedSpace.name}
          repoId={selectedRepo.id}
          repoName={selectedRepo.name}
          base={agentDialogBase}
          parentPath={displayLocationPath(preferredWorktreeParent, DEFAULT_WORKTREE_PARENT_PATH)}
          defaultProvider={selectedSpace.defaultProvider}
          defaultModel={selectedSpace.defaultModel}
          returnFocusTo={agentDialogOpenerRef.current}
          onBusyChange={setAgentDialogBusy}
          onState={commitSpaceState}
          onClose={() => {
            if (!agentDialogBusy) setAgentDialogOpen(false);
          }}
          onCreated={({ state, sessionId }) => {
            commitSpaceState(state);
            setAgentDialogOpen(false);
            setAgentDialogBusy(false);
            void navigate(`/ses/${encodeURIComponent(sessionId)}`);
          }}
        />
      ) : null}
      {sessionDialogOpen && selectedRepo && selectedWorktree ? (
        <div {...stylex.props(dialogs.layer)}>
          <button
            {...stylex.props(dialogs.backdrop)}
            type="button"
            aria-label="Close new session dialog"
            disabled={sessionCreating}
            onClick={() => setSessionDialogOpen(false)}
          />
          <form
            {...stylex.props(dialogs.formModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-session-title"
            onSubmit={submitSession}
          >
            <header {...stylex.props(dialogs.header)}>
              <div>
                <small {...stylex.props(dialogs.eyebrow)}>NEW SESSION</small>
                <h2 {...stylex.props(dialogs.title)} id="new-session-title">
                  Start in {selectedCheckoutLabel}
                </h2>
              </div>
              <button
                {...stylex.props(dialogs.close)}
                type="button"
                aria-label="Close"
                disabled={sessionCreating}
                onClick={() => setSessionDialogOpen(false)}
              >
                ×
              </button>
            </header>
            <p {...stylex.props(dialogs.description)}>
              The session will be created in this checkout and attached to {selectedSpace.name}.
            </p>
            <div {...stylex.props(dialogs.destinationPreview)}>
              <span {...stylex.props(dialogs.labelText)}>GIT CONTEXT</span>
              <code {...stylex.props(dialogs.destinationPath)}>{selectedWorktreePath}</code>
            </div>
            {sessionError ? (
              <p {...stylex.props(dialogs.error)} role="alert">
                {sessionError}
              </p>
            ) : null}
            <label {...stylex.props(dialogs.label)}>
              <span {...stylex.props(dialogs.labelText)}>PROVIDER</span>
              <select
                {...stylex.props(dialogs.input)}
                autoFocus
                value={sessionProvider}
                disabled={sessionCreating}
                onChange={(event) => {
                  setSessionProvider(createProvider(event.target.value));
                  setSessionError(null);
                  setCreatedSessionId(null);
                }}
              >
                {(Object.keys(providerLabels) as CreateProvider[]).map((provider) => (
                  <option key={provider} value={provider}>
                    {providerLabels[provider]}
                  </option>
                ))}
              </select>
            </label>
            {sessionProvider === "opencode" ? (
              <p {...stylex.props(dialogs.formHelp)}>OpenCode will use its provider default.</p>
            ) : (
              <label {...stylex.props(dialogs.label)}>
                <span {...stylex.props(dialogs.labelText)}>MODEL</span>
                <select
                  {...stylex.props(dialogs.input)}
                  value={sessionModelId}
                  disabled={sessionModelsLoading || sessionCreating || !providerModels.length}
                  onChange={(event) => {
                    setSessionModelId(event.target.value);
                    setCreatedSessionId(null);
                  }}
                >
                  {providerModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {sessionProvider === "codex" ? (
              <label {...stylex.props(dialogs.label)}>
                <span {...stylex.props(dialogs.labelText)}>REASONING EFFORT</span>
                <select
                  {...stylex.props(dialogs.input)}
                  value={sessionReasoningEffort}
                  disabled={sessionCreating}
                  onChange={(event) => {
                    setSessionReasoningEffort(event.target.value as CodexReasoningEffort | "");
                    setCreatedSessionId(null);
                  }}
                >
                  <option value="">Provider default</option>
                  {codexReasoningEfforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <footer {...stylex.props(dialogs.footer)}>
              <button
                {...stylex.props(dialogs.button)}
                type="button"
                disabled={sessionCreating}
                onClick={() => setSessionDialogOpen(false)}
              >
                Cancel
              </button>
              <button
                {...stylex.props(
                  dialogs.button,
                  dialogs.primaryButton,
                  (sessionCreating ||
                    sessionModelsLoading ||
                    (sessionProvider !== "opencode" && !sessionModelId)) &&
                    dialogs.disabledButton,
                )}
                type="submit"
                disabled={
                  sessionCreating ||
                  sessionModelsLoading ||
                  (sessionProvider !== "opencode" && !sessionModelId)
                }
              >
                {sessionCreating
                  ? createdSessionId
                    ? "Attaching…"
                    : "Creating…"
                  : createdSessionId
                    ? "Retry attaching"
                    : "Create session"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      {importDialogOpen && selectedRepo && selectedWorktree ? (
        <div {...stylex.props(dialogs.layer)}>
          <button
            {...stylex.props(dialogs.backdrop)}
            type="button"
            aria-label="Close import session dialog"
            disabled={Boolean(importingSessionId)}
            onClick={() => setImportDialogOpen(false)}
          />
          <section
            {...stylex.props(dialogs.pickerModal, dialogs.importModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-session-title"
          >
            <header {...stylex.props(dialogs.header)}>
              <div>
                <small {...stylex.props(dialogs.eyebrow)}>IMPORT SESSION</small>
                <h2 {...stylex.props(dialogs.title)} id="import-session-title">
                  Sessions in {selectedCheckoutLabel}
                </h2>
              </div>
              <button
                {...stylex.props(dialogs.close)}
                type="button"
                aria-label="Close"
                disabled={Boolean(importingSessionId)}
                onClick={() => setImportDialogOpen(false)}
              >
                ×
              </button>
            </header>
            <p {...stylex.props(dialogs.description)}>
              Only unclaimed sessions from this checkout are shown.
            </p>
            {importError ? (
              <p {...stylex.props(dialogs.error)} role="alert">
                {importError}
              </p>
            ) : null}
            <div {...stylex.props(dialogs.importFilters)}>
              <div {...stylex.props(dialogs.searchField)}>
                <span {...stylex.props(dialogs.searchIcon)}>
                  <Icon name="search" />
                </span>
                <input
                  {...stylex.props(dialogs.searchInput)}
                  autoFocus
                  aria-label="Search importable sessions"
                  placeholder="Search sessions"
                  value={importSearch}
                  onChange={(event) => setImportSearch(event.target.value)}
                />
                {importSearch ? (
                  <button
                    {...stylex.props(dialogs.clearSearch)}
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setImportSearch("")}
                  >
                    ×
                  </button>
                ) : null}
              </div>
              <select
                {...stylex.props(dialogs.input, dialogs.importProvider)}
                aria-label="Filter importable sessions by provider"
                value={importProvider}
                onChange={(event) => setImportProvider(event.target.value)}
              >
                <option value="all">All providers</option>
                {importProviders.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </div>
            <div {...stylex.props(dialogs.pickerList, dialogs.importList)}>
              {(t3ImportLoading || paseoImportLoading) && !importableSessions.length ? (
                <div {...stylex.props(dialogs.noResults)}>
                  Scanning configured provider instances…
                </div>
              ) : null}
              {filteredImportableSessions.length ? (
                filteredImportableSessions.map((session) => (
                  <article
                    {...stylex.props(dialogs.importRow)}
                    key={`${session.t3InstanceId ?? session.paseoInstanceId ?? ""}:${session.id}`}
                  >
                    <Avatar tone={session.tone}>{session.agent.charAt(0)}</Avatar>
                    <span {...stylex.props(dialogs.importDetails)}>
                      <strong {...stylex.props(dialogs.pickerTitle)}>{session.title}</strong>
                      <small {...stylex.props(dialogs.pickerPath)}>
                        {session.agent} · {session.provider} · {session.model}
                      </small>
                    </span>
                    <button
                      {...stylex.props(dialogs.button)}
                      type="button"
                      disabled={Boolean(importingSessionId)}
                      onClick={() =>
                        void importSession(
                          session.id,
                          session.t3InstanceId ?? session.paseoInstanceId ?? undefined,
                        )
                      }
                    >
                      {importingSessionId === session.id ? "Importing…" : "Import"}
                    </button>
                  </article>
                ))
              ) : (
                <div {...stylex.props(dialogs.noResults)}>
                  {importableSessions.length
                    ? "No sessions match these filters"
                    : "No unclaimed sessions in this checkout"}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
      {attachRepoOpen ? (
        <div {...stylex.props(dialogs.layer)}>
          <button
            {...stylex.props(dialogs.backdrop)}
            type="button"
            aria-label="Close attach repository dialog"
            onClick={() => setAttachRepoOpen(false)}
          />
          <form
            {...stylex.props(dialogs.formModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="attach-repository-title"
            onSubmit={attachRepository}
          >
            <header {...stylex.props(dialogs.header)}>
              <div>
                <small {...stylex.props(dialogs.eyebrow)}>ATTACH REPOSITORY</small>
                <h2 {...stylex.props(dialogs.title)} id="attach-repository-title">
                  Choose a local repository
                </h2>
              </div>
              <button
                {...stylex.props(dialogs.close)}
                type="button"
                aria-label="Close"
                onClick={() => setAttachRepoOpen(false)}
              >
                ×
              </button>
            </header>
            <p {...stylex.props(dialogs.description)}>
              Enter a local Git repository root or worktree path. A root attaches the main checkout;
              a worktree path attaches that specific checkout too.
            </p>
            {requestError ? (
              <p {...stylex.props(dialogs.error)} role="alert">
                {requestError}
              </p>
            ) : null}
            <label {...stylex.props(dialogs.label)}>
              <span {...stylex.props(dialogs.labelText)}>REPOSITORY NAME</span>
              <input
                {...stylex.props(dialogs.input)}
                autoFocus
                value={customRepoName}
                placeholder="my-project"
                onChange={(event) => setCustomRepoName(event.target.value)}
              />
            </label>
            <label {...stylex.props(dialogs.label)}>
              <span {...stylex.props(dialogs.labelText)}>LOCAL PATH</span>
              <input
                {...stylex.props(dialogs.input)}
                value={customRepoPath}
                placeholder="~/Code/my-project"
                onChange={(event) => setCustomRepoPath(event.target.value)}
              />
            </label>
            <footer {...stylex.props(dialogs.footer)}>
              <button
                {...stylex.props(dialogs.button)}
                type="button"
                onClick={() => setAttachRepoOpen(false)}
              >
                Cancel
              </button>
              <button
                {...stylex.props(
                  dialogs.button,
                  dialogs.primaryButton,
                  !customRepoPath.trim() && dialogs.disabledButton,
                )}
                type="submit"
                disabled={!customRepoPath.trim()}
              >
                Attach repository
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      {editRepoPathOpen && selectedRepo ? (
        <div {...stylex.props(dialogs.layer)}>
          <button
            {...stylex.props(dialogs.backdrop)}
            type="button"
            aria-label="Close edit repository dialog"
            onClick={() => setEditRepoPathOpen(false)}
          />
          <form
            {...stylex.props(dialogs.formModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-repository-title"
            onSubmit={submitRepoPath}
          >
            <header {...stylex.props(dialogs.header)}>
              <div>
                <small {...stylex.props(dialogs.eyebrow)}>REPOSITORY</small>
                <h2 {...stylex.props(dialogs.title)} id="edit-repository-title">
                  Edit repository
                </h2>
              </div>
              <button
                {...stylex.props(dialogs.close)}
                type="button"
                aria-label="Close"
                onClick={() => setEditRepoPathOpen(false)}
              >
                ×
              </button>
            </header>
            <p {...stylex.props(dialogs.description)}>
              Update the display name or local folder. Existing checkouts stay attached.
            </p>
            <label {...stylex.props(dialogs.label)}>
              <span {...stylex.props(dialogs.labelText)}>REPOSITORY NAME</span>
              <input
                {...stylex.props(dialogs.input)}
                autoFocus
                value={repoNameDraft}
                onChange={(event) => setRepoNameDraft(event.target.value)}
              />
            </label>
            <label {...stylex.props(dialogs.label)}>
              <span {...stylex.props(dialogs.labelText)}>LOCAL PATH</span>
              <input
                {...stylex.props(dialogs.input)}
                value={repoPathDraft}
                onChange={(event) => setRepoPathDraft(event.target.value)}
              />
            </label>
            <footer {...stylex.props(dialogs.footer)}>
              <button
                {...stylex.props(dialogs.button)}
                type="button"
                onClick={() => setEditRepoPathOpen(false)}
              >
                Cancel
              </button>
              <button
                {...stylex.props(
                  dialogs.button,
                  dialogs.primaryButton,
                  (!repoNameDraft.trim() || !repoPathDraft.trim()) && dialogs.disabledButton,
                )}
                type="submit"
                disabled={!repoNameDraft.trim() || !repoPathDraft.trim()}
              >
                Save repository
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      {worktreeFormOpen && selectedRepo ? (
        <div {...stylex.props(dialogs.layer)}>
          <button
            {...stylex.props(dialogs.backdrop)}
            type="button"
            aria-label="Close new worktree dialog"
            onClick={() => setWorktreeFormOpen(false)}
          />
          <form
            {...stylex.props(dialogs.formModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-worktree-title"
            onSubmit={submitWorktree}
          >
            <header {...stylex.props(dialogs.header)}>
              <div>
                <small {...stylex.props(dialogs.eyebrow)}>NEW WORKTREE</small>
                <h2 {...stylex.props(dialogs.title)} id="new-worktree-title">
                  Add to {selectedRepo.name}
                </h2>
              </div>
              <button
                {...stylex.props(dialogs.close)}
                type="button"
                aria-label="Close"
                onClick={() => setWorktreeFormOpen(false)}
              >
                ×
              </button>
            </header>
            <p {...stylex.props(dialogs.description)}>
              Choose a branch and base, then confirm where its linked worktree will live.
            </p>
            <label {...stylex.props(dialogs.label)}>
              <span {...stylex.props(dialogs.labelText)}>BRANCH</span>
              <input
                {...stylex.props(dialogs.input)}
                autoFocus
                value={worktreeNameDraft}
                placeholder="feature/new-flow"
                onChange={(event) => setWorktreeNameDraft(event.target.value)}
              />
            </label>
            <label {...stylex.props(dialogs.label)}>
              <span {...stylex.props(dialogs.labelText)}>CREATE FROM</span>
              <input
                {...stylex.props(dialogs.input)}
                value={worktreeBase}
                placeholder="main"
                onChange={(event) => setWorktreeBase(event.target.value)}
              />
            </label>
            <label {...stylex.props(dialogs.label)}>
              <span {...stylex.props(dialogs.labelText)}>PARENT FOLDER</span>
              <input
                {...stylex.props(dialogs.input)}
                value={worktreeParentDraft}
                placeholder="~/Code"
                onChange={(event) => setWorktreeParentDraft(event.target.value)}
              />
            </label>
            <div {...stylex.props(dialogs.destinationPreview)}>
              <span {...stylex.props(dialogs.labelText)}>WORKTREE PATH</span>
              <code {...stylex.props(dialogs.destinationPath)}>{worktreeDestination}</code>
              <small {...stylex.props(dialogs.destinationHint)}>
                This is a one-off override. Change the default in Settings.
              </small>
            </div>
            <footer {...stylex.props(dialogs.footer)}>
              <button
                {...stylex.props(dialogs.button)}
                type="button"
                onClick={() => setWorktreeFormOpen(false)}
              >
                Cancel
              </button>
              <button
                {...stylex.props(
                  dialogs.button,
                  dialogs.primaryButton,
                  (!worktreeNameDraft.trim() || !worktreeParentDraft.trim()) &&
                    dialogs.disabledButton,
                )}
                type="submit"
                disabled={!worktreeNameDraft.trim() || !worktreeParentDraft.trim()}
              >
                Create worktree
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      {movingSession || movingSpace ? (
        <div {...stylex.props(dialogs.layer)}>
          <button
            {...stylex.props(dialogs.backdrop)}
            type="button"
            aria-label="Close move dialog"
            onClick={() => {
              setMoveSessionId(null);
              setMoveSpaceId(null);
            }}
          />
          <section
            {...stylex.props(dialogs.moveModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-item-title"
          >
            <header {...stylex.props(dialogs.header)}>
              <div>
                <small {...stylex.props(dialogs.eyebrow)}>
                  {movingSpace ? "MOVE SPACE" : "MOVE SESSION"}
                </small>
                <h2 {...stylex.props(dialogs.title)} id="move-item-title">
                  Move “{movingSpace?.name ?? movingSession?.title}”
                </h2>
              </div>
              <button
                {...stylex.props(dialogs.close)}
                type="button"
                aria-label="Close"
                onClick={() => {
                  setMoveSessionId(null);
                  setMoveSpaceId(null);
                }}
              >
                ×
              </button>
            </header>
            <p {...stylex.props(dialogs.description)}>
              {movingSpace
                ? "Choose a new parent space, or move it to the top level."
                : "Choose a space, then move the session there."}
            </p>
            <div {...stylex.props(dialogs.searchWrap)} data-move-search>
              <div {...stylex.props(dialogs.searchField)}>
                <span {...stylex.props(dialogs.searchIcon)}>
                  <Icon name="search" />
                </span>
                <input
                  {...stylex.props(dialogs.searchInput)}
                  autoFocus
                  role="combobox"
                  aria-label="Search destination spaces"
                  aria-autocomplete="list"
                  aria-expanded={Boolean(normalizedMoveSearch)}
                  aria-controls="move-space-results"
                  aria-activedescendant={
                    moveSearchResults[moveSearchIndex]
                      ? `move-space-result-${moveSearchResults[moveSearchIndex].space.id}`
                      : undefined
                  }
                  placeholder="Search spaces…"
                  value={moveSearch}
                  onChange={(event) => {
                    setMoveSearch(event.target.value);
                    setMoveSearchIndex(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      if (moveSearch) {
                        setMoveSearch("");
                        setMoveSearchIndex(0);
                      } else {
                        setMoveSessionId(null);
                        setMoveSpaceId(null);
                      }
                      return;
                    }
                    if (!moveSearchResults.length) {
                      return;
                    }
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setMoveSearchIndex((index) => (index + 1) % moveSearchResults.length);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setMoveSearchIndex(
                        (index) =>
                          (index - 1 + moveSearchResults.length) % moveSearchResults.length,
                      );
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      chooseMoveSearchResult(moveSearchResults[moveSearchIndex].space.id);
                    }
                  }}
                />
                {moveSearch ? (
                  <button
                    {...stylex.props(dialogs.clearSearch)}
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setMoveSearch("")}
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {normalizedMoveSearch ? (
                <div {...stylex.props(dialogs.results)} id="move-space-results" role="listbox">
                  {moveSearchResults.length ? (
                    moveSearchResults.map(({ space, path }, index) => (
                      <button
                        {...stylex.props(
                          dialogs.result,
                          index === moveSearchIndex && dialogs.resultActive,
                        )}
                        id={`move-space-result-${space.id}`}
                        type="button"
                        role="option"
                        aria-selected={index === moveSearchIndex}
                        key={space.id}
                        onMouseEnter={() => setMoveSearchIndex(index)}
                        onClick={() => chooseMoveSearchResult(space.id)}
                      >
                        <span {...stylex.props(dialogs.resultIcon)}>
                          <Icon name="folder" />
                        </span>
                        <span>
                          <strong {...stylex.props(dialogs.resultTitle)}>{space.name}</strong>
                          <small {...stylex.props(dialogs.resultPath)}>{path}</small>
                        </span>
                        {movingSourceSpace?.id === space.id ? (
                          <em {...stylex.props(dialogs.currentBadge)}>Current</em>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <div {...stylex.props(dialogs.noResults)}>No matching spaces</div>
                  )}
                </div>
              ) : null}
            </div>
            <nav {...stylex.props(dialogs.breadcrumb)} aria-label="Move destination">
              <button
                {...stylex.props(
                  dialogs.breadcrumbButton,
                  moveBrowseSpaceId === null && dialogs.breadcrumbCurrent,
                )}
                type="button"
                onClick={() => setMoveBrowseSpaceId(null)}
              >
                All spaces
              </button>
              {moveCrumbs.map((space) => (
                <span {...stylex.props(dialogs.breadcrumbPart)} key={space.id}>
                  <i {...stylex.props(dialogs.breadcrumbSeparator)}>/</i>
                  <button
                    {...stylex.props(
                      dialogs.breadcrumbButton,
                      space.id === moveBrowseSpaceId && dialogs.breadcrumbCurrent,
                    )}
                    type="button"
                    onClick={() => setMoveBrowseSpaceId(space.id)}
                  >
                    {space.name}
                  </button>
                </span>
              ))}
            </nav>
            <ul {...stylex.props(dialogs.moveList)}>
              {moveChildren.length ? (
                moveChildren.map((space) => (
                  <li key={space.id}>
                    <button
                      {...stylex.props(dialogs.moveItem)}
                      type="button"
                      onClick={() => setMoveBrowseSpaceId(space.id)}
                    >
                      <span {...stylex.props(dialogs.moveItemName)}>
                        <Icon name="folder" />
                        {space.name}
                      </span>
                      <span>›</span>
                    </button>
                  </li>
                ))
              ) : (
                <li {...stylex.props(dialogs.emptyMoveList)}>No subspaces here</li>
              )}
            </ul>
            <footer {...stylex.props(dialogs.footer, dialogs.moveFooter)}>
              <button
                {...stylex.props(dialogs.button)}
                type="button"
                onClick={() => {
                  setMoveSessionId(null);
                  setMoveSpaceId(null);
                }}
              >
                Cancel
              </button>
              <button
                {...stylex.props(
                  dialogs.button,
                  dialogs.primaryButton,
                  moveAlreadyHere && dialogs.disabledButton,
                )}
                type="button"
                disabled={moveAlreadyHere}
                onClick={() => {
                  if (moveSpaceId) {
                    void applyMutation(moveSpace(moveSpaceId, moveBrowseSpaceId)).then((next) => {
                      if (!next) return;
                      setMoveSessionId(null);
                      setMoveSpaceId(null);
                    });
                  } else if (moveSessionId && moveBrowseSpaceId) {
                    void applyMutation(moveSession(moveSessionId, moveBrowseSpaceId)).then(
                      (next) => {
                        if (!next) return;
                        setMoveSessionId(null);
                        setMoveSpaceId(null);
                      },
                    );
                  } else {
                    return;
                  }
                }}
              >
                Move to {moveBrowseSpace?.name ?? (movingSpace ? "top level" : "selected space")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {spaceForm ? (
        <div {...stylex.props(dialogs.layer)}>
          <button
            {...stylex.props(dialogs.backdrop)}
            type="button"
            aria-label="Close space dialog"
            onClick={() => setSpaceForm(null)}
          />
          <form
            {...stylex.props(dialogs.formModal)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="space-form-title"
            onSubmit={(event) => {
              event.preventDefault();
              submitSpaceForm();
            }}
          >
            <header {...stylex.props(dialogs.header)}>
              <div>
                <small {...stylex.props(dialogs.eyebrow)}>
                  {spaceForm === "create" ? "NEW SPACE" : "EDIT SPACE"}
                </small>
                <h2 {...stylex.props(dialogs.title)} id="space-form-title">
                  {spaceForm === "create" ? "Create a space" : `Edit ${selectedSpace.name}`}
                </h2>
              </div>
              <button
                {...stylex.props(dialogs.close)}
                type="button"
                aria-label="Close"
                onClick={() => setSpaceForm(null)}
              >
                ×
              </button>
            </header>
            {spaceForm === "create" ? (
              <p {...stylex.props(dialogs.description)}>
                This space will be created under <strong>{spaceParentLabel}</strong>. Choose “Top
                level” to create it alongside the other root spaces.
              </p>
            ) : null}
            {spaceForm === "create" ? (
              <label {...stylex.props(dialogs.label)}>
                <span {...stylex.props(dialogs.labelText)}>PARENT SPACE</span>
                <select
                  {...stylex.props(dialogs.input)}
                  aria-label="Parent space"
                  value={spaceParentId ?? ""}
                  onChange={(event) => setSpaceParentId(event.target.value || null)}
                >
                  <option value="">Top level</option>
                  {spaceParentOptions.map((space) => (
                    <option value={space.id} key={space.id}>
                      {pathForSpace(space)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label {...stylex.props(dialogs.label)}>
              <span {...stylex.props(dialogs.labelText)}>SPACE NAME</span>
              <input
                {...stylex.props(dialogs.input)}
                autoFocus
                value={spaceName}
                onChange={(event) => setSpaceName(event.target.value)}
              />
            </label>
            <label {...stylex.props(dialogs.label)}>
              <span {...stylex.props(dialogs.labelText)}>DESCRIPTION</span>
              <textarea
                {...stylex.props(dialogs.input, dialogs.textarea)}
                value={spaceContext}
                placeholder="What belongs in this space?"
                onChange={(event) => setSpaceContext(event.target.value)}
              />
            </label>
            <footer {...stylex.props(dialogs.footer)}>
              <button
                {...stylex.props(dialogs.button)}
                type="button"
                onClick={() => setSpaceForm(null)}
              >
                Cancel
              </button>
              <button
                {...stylex.props(
                  dialogs.button,
                  dialogs.primaryButton,
                  !spaceName.trim() && dialogs.disabledButton,
                )}
                type="submit"
                disabled={!spaceName.trim()}
              >
                {spaceForm === "create" ? "Create space" : "Save changes"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      <SpaceActivityHistory
        open={historyOpen}
        spaceId={selectedSpace.id}
        spaceName={selectedSpace.name}
        onClose={() => setHistoryOpen(false)}
        refreshToken={liveRefresh.refreshToken}
        returnFocusTo={historyButtonRef.current}
      />
    </div>
  );
}

export function NewDashboardPage() {
  useEffect(() => {
    document.title = "Say To Me — Spaces";
  }, []);

  return (
    <div {...stylex.props(chrome.root)}>
      <DashboardLiveRefreshProvider>
        <ExplorerDashboard />
      </DashboardLiveRefreshProvider>
    </div>
  );
}
