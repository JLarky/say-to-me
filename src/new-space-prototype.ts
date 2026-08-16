export type PrototypeSessionStatus =
  | "Working"
  | "Needs input"
  | "Waiting"
  | "Idle"
  | "Attached"
  | "Jarvis";

export type PrototypeRosterStatus = "error" | "attention" | "working" | "idle" | "unknown";

export interface PrototypeSession {
  id: string;
  t3InstanceId?: string | null;
  paseoInstanceId?: string | null;
  title: string;
  agent: string;
  provider: string;
  model: string;
  status: PrototypeSessionStatus;
  tone: string;
  state?: "important" | "general" | "archived" | "jarvis";
  repoId?: string;
  worktree?: string;
  worktreeId?: string;
  archived?: boolean;
  rosterStatus?: PrototypeRosterStatus;
  rosterStatusLabel?: string;
  workspacePath?: string | null;
  workspaceLabel?: string | null;
  importedAt?: string | null;
  latestSayMessage?: string | null;
  latestSayAuthor?: "agent" | "user" | null;
  latestSayAt?: string | null;
  latestDeliveryStatus?: string | null;
  latestDeliveryError?: string | null;
  latestActivityText?: string | null;
  activityAt?: string | null;
  cachedOpenCodeStatus?: string | null;
  cachedActivityStatus?: string | null;
  timerSummary?: string | null;
}

export interface PrototypeRepo {
  id: string;
  name: string;
  path: string;
  inheritedFromRepoId?: string;
  primaryBranch?: string;
  primaryWorktreeId?: string;
  worktrees: string[];
  availableWorktrees?: string[];
  availableWorktreeBranches?: Record<string, string>;
  worktreeBranches?: Record<string, string>;
  worktreePaths?: Record<string, string>;
  worktreeIds?: Record<string, string>;
}

export interface PrototypeSpace {
  id: string;
  name: string;
  parentId: string | null;
  archived: boolean;
  context: string;
  defaultProvider?: string;
  defaultModel?: string;
  access?: "private" | "shared";
  /** Sibling display order; lower first. */
  sortOrder?: number;
  repos: PrototypeRepo[];
  sessions: PrototypeSession[];
  importableSessions?: PrototypeSession[];
}

export interface PrototypeSpacesState {
  spaces: PrototypeSpace[];
  selectedSpaceId: string;
}

export interface DiscoveredPrototypeRepo {
  name: string;
  path: string;
}

export interface PrototypeProfile {
  name: string;
}

export const PROTOTYPE_SPACES_KEY = "say-to-me:new-spaces-prototype:v1";
export const PROTOTYPE_PROFILE_KEY = "say-to-me:new-profile-prototype:v1";
export const DISCOVERED_PROTOTYPE_REPOS: DiscoveredPrototypeRepo[] = [
  { name: "speech-lab", path: "~/vm/JLarky/speech-lab" },
  { name: "agent-playground", path: "~/vm/JLarky/agent-playground" },
  { name: "docs-site", path: "~/vm/JLarky/docs-site" },
  { name: "operations", path: "~/vm/JLarky/operations" },
];

const PrototypeSessionSchema = type({
  id: "string",
  "t3InstanceId?": "string | null",
  "paseoInstanceId?": "string | null",
  title: "string",
  agent: "string",
  provider: "string",
  model: "string",
  status: "'Working' | 'Needs input' | 'Waiting' | 'Idle' | 'Attached' | 'Jarvis'",
  tone: "string",
  "state?": "'important' | 'general' | 'archived' | 'jarvis'",
  "repoId?": "string",
  "worktree?": "string",
  "worktreeId?": "string",
  "archived?": "boolean",
  "rosterStatus?": "'error' | 'attention' | 'working' | 'idle' | 'unknown'",
  "rosterStatusLabel?": "string",
  "workspacePath?": "string | null",
  "workspaceLabel?": "string | null",
  "importedAt?": "string | null",
  "latestSayMessage?": "string | null",
  "latestSayAuthor?": "'agent' | 'user' | null",
  "latestSayAt?": "string | null",
  "latestDeliveryStatus?": "string | null",
  "latestDeliveryError?": "string | null",
  "latestActivityText?": "string | null",
  "activityAt?": "string | null",
  "cachedOpenCodeStatus?": "string | null",
  "cachedActivityStatus?": "string | null",
  "timerSummary?": "string | null",
});

const PrototypeRepoSchema = type({
  id: "string",
  name: "string",
  path: "string",
  "inheritedFromRepoId?": "string",
  "primaryBranch?": "string",
  "primaryWorktreeId?": "string",
  worktrees: "string[]",
  "availableWorktrees?": "string[]",
  "availableWorktreeBranches?": { "[string]": "string" },
  "worktreeBranches?": { "[string]": "string" },
  "worktreePaths?": { "[string]": "string" },
  "worktreeIds?": { "[string]": "string" },
});

const PrototypeSpaceSchema = type({
  id: "string",
  name: "string",
  parentId: "string | null",
  archived: "boolean",
  context: "string",
  "defaultProvider?": "string",
  "defaultModel?": "string",
  "access?": "'private' | 'shared'",
  "sortOrder?": "number",
  repos: PrototypeRepoSchema.array(),
  sessions: PrototypeSessionSchema.array(),
  "importableSessions?": PrototypeSessionSchema.array(),
});

export const PrototypeSpacesSchema = type({
  spaces: PrototypeSpaceSchema.array(),
  selectedSpaceId: "string",
});

const PrototypeProfileSchema = type({
  name: "string",
});

const seededState: PrototypeSpacesState = {
  selectedSpaceId: "space-say-to-me",
  spaces: [
    {
      id: "space-say-to-me",
      name: "Say To Me",
      parentId: null,
      archived: false,
      context: "A local voice coordination layer for AI agents.",
      repos: [
        {
          id: "repo-say-to-me",
          name: "say-to-me",
          path: "~/vm/JLarky/say-to-me",
          primaryBranch: "feature/dashboard-scope",
          worktrees: ["new-system", "session-import"],
          worktreeBranches: {
            "new-system": "feature/new-system",
            "session-import": "fix/session-import",
          },
        },
        {
          id: "repo-agent-tools",
          name: "agent-tools",
          path: "~/vm/JLarky/agent-tools",
          primaryBranch: "main",
          worktrees: [],
        },
        {
          id: "repo-voice-playback",
          name: "voice-playback",
          path: "~/vm/JLarky/voice-playback",
          primaryBranch: "main",
          worktrees: [],
        },
      ],
      sessions: [
        {
          id: "session-jarvis",
          title: "Dashboard prototype coordinator",
          agent: "Jarvis",
          provider: "OpenCode",
          model: "GPT-5.6",
          status: "Working",
          tone: "lime",
          repoId: "repo-say-to-me",
          worktree: "new-system",
        },
        {
          id: "session-codex",
          title: "Implement import confirmation",
          agent: "Codex CLI",
          provider: "Codex",
          model: "GPT-5.4",
          status: "Working",
          tone: "blue",
          repoId: "repo-say-to-me",
          worktree: "session-import",
        },
        {
          id: "session-morgan",
          title: "Review project architecture",
          agent: "Morgan",
          provider: "OpenCode",
          model: "Claude",
          status: "Needs input",
          tone: "coral",
          repoId: "repo-agent-tools",
          worktree: "__primary__",
        },
      ],
    },
    {
      id: "space-voice-queue",
      name: "Voice queue",
      parentId: "space-say-to-me",
      archived: false,
      context: "Playback, delivery, and notification behavior.",
      repos: [
        {
          id: "repo-voice-child",
          name: "voice-playback",
          path: "~/vm/JLarky/voice-playback",
          primaryBranch: "fix/playback-queue",
          worktrees: [],
        },
      ],
      sessions: [
        {
          id: "session-voice-review",
          title: "Review playback queue",
          agent: "Morgan",
          provider: "OpenCode",
          model: "Claude",
          status: "Waiting",
          tone: "coral",
          repoId: "repo-voice-child",
          worktree: "__primary__",
        },
        {
          id: "session-voice-fix",
          title: "Fix browser playback",
          agent: "Codex CLI",
          provider: "Codex",
          model: "GPT-5.4",
          status: "Working",
          tone: "blue",
          repoId: "repo-voice-child",
          worktree: "__primary__",
        },
      ],
    },
    {
      id: "space-dashboard",
      name: "Dashboard prototype",
      parentId: "space-say-to-me",
      archived: false,
      context: "Prototype the next generation space navigation.",
      repos: [
        {
          id: "repo-dashboard",
          name: "say-to-me",
          path: "~/vm/JLarky/say-to-me-new-system",
          primaryBranch: "feature/new-system",
          worktrees: [],
        },
      ],
      sessions: [],
    },
    {
      id: "space-content",
      name: "Content lab",
      parentId: null,
      archived: false,
      context: "Videos, writing, and launch materials.",
      repos: [
        {
          id: "repo-content",
          name: "content",
          path: "~/vm/JLarky/content",
          primaryBranch: "main",
          worktrees: [],
        },
      ],
      sessions: [],
    },
  ],
};

function cloneSeededState(): PrototypeSpacesState {
  return structuredClone(seededState);
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

const seededSessionGitContexts = new Map<string, Pick<PrototypeSession, "repoId" | "worktree">>([
  ["session-jarvis", { repoId: "repo-say-to-me", worktree: "new-system" }],
  ["session-codex", { repoId: "repo-say-to-me", worktree: "session-import" }],
  ["session-morgan", { repoId: "repo-agent-tools", worktree: "__primary__" }],
  ["session-voice-review", { repoId: "repo-voice-child", worktree: "__primary__" }],
  ["session-voice-fix", { repoId: "repo-voice-child", worktree: "__primary__" }],
]);

function normalizePrototypeRepo(repo: PrototypeRepo): PrototypeRepo {
  if (repo.primaryBranch) return repo;
  const primaryBranch = repo.worktrees.includes("main") ? "main" : (repo.worktrees[0] ?? "main");
  const branches = repo.worktrees.filter((branch) => branch !== primaryBranch);
  const worktrees = branches.map((branch) => branch.split("/").filter(Boolean).at(-1) ?? branch);
  return {
    ...repo,
    primaryBranch,
    worktrees,
    worktreeBranches: Object.fromEntries(worktrees.map((name, index) => [name, branches[index]])),
    worktreePaths: Object.fromEntries(
      worktrees.flatMap((name, index) => {
        const path = repo.worktreePaths?.[branches[index]];
        return path ? [[name, path]] : [];
      }),
    ),
  };
}

export function loadPrototypeSpaces(): PrototypeSpacesState {
  try {
    const stored = localStorage.getItem(PROTOTYPE_SPACES_KEY);
    if (!stored) return cloneSeededState();
    const parsed = safeJsonParse(PrototypeSpacesSchema, stored);
    if (!parsed) return cloneSeededState();
    return {
      ...parsed,
      spaces: parsed.spaces.map((space) => {
        const repos = space.repos.map(normalizePrototypeRepo);
        return {
          ...space,
          repos,
          sessions: space.sessions.map((storedSession) => {
            const session = { ...storedSession, ...seededSessionGitContexts.get(storedSession.id) };
            const repo = repos.find((item) => item.id === session.repoId);
            if (!repo || !session.worktree || session.worktree === "__primary__") return session;
            if (repo.worktrees.includes(session.worktree)) return session;
            const checkout = Object.entries(repo.worktreeBranches ?? {}).find(
              ([, branch]) => branch === session.worktree,
            )?.[0];
            return { ...session, worktree: checkout ?? session.worktree };
          }),
        };
      }),
    };
  } catch {
    return cloneSeededState();
  }
}

export function savePrototypeSpaces(state: PrototypeSpacesState): void {
  localStorage.setItem(PROTOTYPE_SPACES_KEY, JSON.stringify(state));
}

export function sortPrototypeRosterSessions<T extends PrototypeSession>(sessions: T[]): T[] {
  const order = {
    error: 0,
    attention: 1,
    working: 2,
    idle: 3,
    unknown: 4,
  } satisfies Record<PrototypeRosterStatus, number>;
  return [...sessions].sort((a, b) => {
    const aStatus = a.rosterStatus ?? "unknown";
    const bStatus = b.rosterStatus ?? "unknown";
    const byStatus = order[aStatus] - order[bStatus];
    if (byStatus !== 0) return byStatus;
    const aTime = Date.parse(
      (a.activityAt?.endsWith("Z") ? a.activityAt : a.activityAt ? `${a.activityAt}Z` : "") || "",
    );
    const bTime = Date.parse(
      (b.activityAt?.endsWith("Z") ? b.activityAt : b.activityAt ? `${b.activityAt}Z` : "") || "",
    );
    const safeA = Number.isFinite(aTime) ? aTime : 0;
    const safeB = Number.isFinite(bTime) ? bTime : 0;
    if (safeB !== safeA) return safeB - safeA;
    return a.id.localeCompare(b.id);
  });
}

export function compareSpacesBySortOrder(a: PrototypeSpace, b: PrototypeSpace): number {
  return compareSpacesBySortOrderShared(a, b);
}

export function sortSpacesBySortOrder<T extends PrototypeSpace>(spaces: T[]): T[] {
  return sortSpacesBySortOrderShared(spaces);
}

export function flattenSpacesDepthFirst<T extends PrototypeSpace>(
  spaces: readonly T[],
  options?: { includeArchived?: boolean },
): T[] {
  return flattenSpacesDepthFirstShared(spaces, options);
}

export function firstActiveSpaceId(spaces: readonly PrototypeSpace[]): string {
  return firstActiveSpaceIdShared(spaces);
}

export function loadPrototypeProfile(): PrototypeProfile {
  try {
    const stored = localStorage.getItem(PROTOTYPE_PROFILE_KEY);
    if (!stored) return { name: "Yaroslav Lapin" };
    const profile = safeJsonParse(PrototypeProfileSchema, stored);
    if (!profile) return { name: "Yaroslav Lapin" };
    return profile.name === "Yuri Lapin" ? { ...profile, name: "Yaroslav Lapin" } : profile;
  } catch {
    return { name: "Yaroslav Lapin" };
  }
}

export function savePrototypeProfile(profile: PrototypeProfile): void {
  localStorage.setItem(PROTOTYPE_PROFILE_KEY, JSON.stringify(profile));
}

export function profileInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase();
  return `${words[0][0]}${words.at(-1)![0]}`.toLocaleUpperCase();
}

export function resetPrototypeSpaces(): PrototypeSpacesState {
  localStorage.removeItem(PROTOTYPE_SPACES_KEY);
  return cloneSeededState();
}

export function createPrototypeSpace(
  state: PrototypeSpacesState,
  name: string,
  parentId: string | null,
  context?: string,
): PrototypeSpacesState {
  const space: PrototypeSpace = {
    id: makeId("space"),
    name,
    parentId,
    archived: false,
    context:
      context ||
      (parentId
        ? `A new subspace inheriting context from ${state.spaces.find((item) => item.id === parentId)?.name ?? "its parent"}.`
        : "A new space for related projects and agent work."),
    repos: parentId
      ? (state.spaces.find((item) => item.id === parentId)?.repos ?? []).map((repo) => ({
          id: makeId("repo"),
          name: repo.name,
          path: repo.path,
          inheritedFromRepoId: repo.id,
          primaryBranch: repo.primaryBranch ?? repo.worktrees[0] ?? "main",
          worktrees: [],
        }))
      : [],
    sessions: [],
  };
  return { spaces: [...state.spaces, space], selectedSpaceId: space.id };
}

function subtreeIds(spaces: PrototypeSpace[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const space of spaces) {
      if (space.parentId && ids.has(space.parentId) && !ids.has(space.id)) {
        ids.add(space.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function setPrototypeSpaceArchived(
  state: PrototypeSpacesState,
  spaceId: string,
  archived: boolean,
): PrototypeSpacesState {
  const ids = subtreeIds(state.spaces, spaceId);
  const spaces = state.spaces.map((space) => (ids.has(space.id) ? { ...space, archived } : space));
  const nextSelected = archived ? firstActiveSpaceId(spaces) || state.selectedSpaceId : spaceId;
  return { spaces, selectedSpaceId: nextSelected };
}

export function movePrototypeSpace(
  state: PrototypeSpacesState,
  spaceId: string,
  destinationParentId: string | null,
): PrototypeSpacesState {
  const space = state.spaces.find((item) => item.id === spaceId);
  if (!space || space.parentId === destinationParentId || spaceId === destinationParentId)
    return state;
  if (destinationParentId && subtreeIds(state.spaces, spaceId).has(destinationParentId))
    return state;
  if (destinationParentId && !state.spaces.some((item) => item.id === destinationParentId))
    return state;
  return {
    ...state,
    spaces: state.spaces.map((item) =>
      item.id === spaceId ? { ...item, parentId: destinationParentId } : item,
    ),
  };
}

export function deletePrototypeSpace(
  state: PrototypeSpacesState,
  spaceId: string,
): PrototypeSpacesState {
  const ids = subtreeIds(state.spaces, spaceId);
  const spaces = state.spaces.filter((space) => !ids.has(space.id));
  return { spaces, selectedSpaceId: firstActiveSpaceId(spaces) };
}

export function movePrototypeSession(
  state: PrototypeSpacesState,
  sessionId: string,
  destinationSpaceId: string,
): PrototypeSpacesState {
  const source = state.spaces.find((space) =>
    space.sessions.some((session) => session.id === sessionId),
  );
  const destination = state.spaces.find((space) => space.id === destinationSpaceId);
  const session = source?.sessions.find((item) => item.id === sessionId);
  if (!source || !destination || !session || source.id === destination.id) return state;
  return {
    ...state,
    spaces: state.spaces.map((space) => {
      if (space.id === source.id) {
        return { ...space, sessions: space.sessions.filter((item) => item.id !== sessionId) };
      }
      if (space.id === destination.id) {
        return { ...space, sessions: [...space.sessions, session] };
      }
      return space;
    }),
  };
}

export function archivePrototypeSession(
  state: PrototypeSpacesState,
  sessionId: string,
): PrototypeSpacesState {
  return {
    ...state,
    spaces: state.spaces.map((space) => ({
      ...space,
      sessions: space.sessions.map((session) =>
        session.id === sessionId ? { ...session, archived: true } : session,
      ),
    })),
  };
}

export function attachPrototypeRepo(
  state: PrototypeSpacesState,
  spaceId: string,
  repo: DiscoveredPrototypeRepo,
): PrototypeSpacesState {
  const name = repo.name.trim();
  const path = repo.path.trim();
  if (!name || !path) return state;
  return {
    ...state,
    spaces: state.spaces.map((space) => {
      if (space.id !== spaceId || space.repos.some((item) => item.path === path)) return space;
      return {
        ...space,
        repos: [
          ...space.repos,
          { id: makeId("repo"), name, path, primaryBranch: "main", worktrees: [] },
        ],
      };
    }),
  };
}

export function updatePrototypeRepo(
  state: PrototypeSpacesState,
  spaceId: string,
  repoId: string,
  name: string,
  path: string,
): PrototypeSpacesState {
  const nextName = name.trim();
  const nextPath = path.trim();
  if (!nextName || !nextPath) return state;
  return {
    ...state,
    spaces: state.spaces.map((space) =>
      space.id === spaceId
        ? {
            ...space,
            repos: space.repos.map((repo) =>
              repo.id === repoId ? { ...repo, name: nextName, path: nextPath } : repo,
            ),
          }
        : space,
    ),
  };
}

export function detachPrototypeRepo(
  state: PrototypeSpacesState,
  spaceId: string,
  repoId: string,
): PrototypeSpacesState {
  return {
    ...state,
    spaces: state.spaces.map((space) =>
      space.id === spaceId
        ? { ...space, repos: space.repos.filter((repo) => repo.id !== repoId) }
        : space,
    ),
  };
}

export function addPrototypeWorktree(
  state: PrototypeSpacesState,
  spaceId: string,
  repoId: string,
  worktree: string,
  branch: string,
  path: string,
): PrototypeSpacesState {
  const name = worktree.trim();
  const branchName = branch.trim();
  const worktreePath = path.trim();
  if (!name || !branchName || !worktreePath) return state;
  return {
    ...state,
    spaces: state.spaces.map((space) =>
      space.id === spaceId
        ? {
            ...space,
            repos: space.repos.map((repo) =>
              repo.id === repoId ? addWorktreeToRepo(repo, name, branchName, worktreePath) : repo,
            ),
          }
        : space,
    ),
  };
}

function addWorktreeToRepo(
  repo: PrototypeRepo,
  name: string,
  branch: string,
  path: string,
): PrototypeRepo {
  const primaryBranch = repo.primaryBranch ?? repo.worktrees[0] ?? "main";
  const worktrees = repo.primaryBranch ? repo.worktrees : repo.worktrees.slice(1);
  if (worktrees.includes(name)) return repo;
  return {
    ...repo,
    primaryBranch,
    worktrees: [...worktrees, name],
    worktreeBranches: { ...repo.worktreeBranches, [name]: branch },
    worktreePaths: { ...repo.worktreePaths, [name]: path },
  };
}

export function deletePrototypeWorktree(
  state: PrototypeSpacesState,
  spaceId: string,
  repoId: string,
  worktree: string,
): PrototypeSpacesState {
  return {
    ...state,
    spaces: state.spaces.map((space) =>
      space.id === spaceId
        ? {
            ...space,
            repos: space.repos.map((repo) =>
              repo.id === repoId ? removePrototypeWorktree(repo, worktree) : repo,
            ),
          }
        : space,
    ),
  };
}

function removePrototypeWorktree(repo: PrototypeRepo, worktree: string): PrototypeRepo {
  const worktreePaths = { ...repo.worktreePaths };
  const worktreeBranches = { ...repo.worktreeBranches };
  delete worktreePaths[worktree];
  delete worktreeBranches[worktree];
  return {
    ...repo,
    worktrees: repo.worktrees.filter((item) => item !== worktree),
    worktreeBranches,
    worktreePaths,
  };
}
import { type } from "arktype";

import { safeJsonParse } from "@say-to-me/runtime-validation";
import {
  compareSpacesBySortOrder as compareSpacesBySortOrderShared,
  firstActiveSpaceId as firstActiveSpaceIdShared,
  flattenSpacesDepthFirst as flattenSpacesDepthFirstShared,
  sortSpacesBySortOrder as sortSpacesBySortOrderShared,
} from "./space-sort-order.ts";
