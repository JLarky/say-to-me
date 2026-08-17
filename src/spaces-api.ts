import { type as arktype } from "arktype";
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- Spaces API response helpers preserve server-defined JSON fields while selecting known data. */
import { safeResponseJson } from "@say-to-me/runtime-validation";
import { PrototypeSpacesSchema, type PrototypeSpacesState } from "./new-space-prototype.ts";

const PlacementSchema = arktype({
  spaceId: "string",
  repositoryId: "string | null",
  worktreeId: "string | null",
  isMainCheckout: "boolean | null",
  canonicalDashboardPath: "string",
  attachedRepository: "boolean",
  attachedWorktree: "boolean",
});

const SpacesResponse = arktype({
  state: PrototypeSpacesSchema,
  "spaceId?": "string",
  "repositoryId?": "string",
  "placement?": PlacementSchema,
});
const SpacesErrorResponse = arktype({ error: "string" });

export type PlaceSessionPlacement = typeof PlacementSchema.infer;

export type SpacesMutationResult = {
  state: PrototypeSpacesState;
  spaceId?: string;
  repositoryId?: string;
  placement?: PlaceSessionPlacement;
};

async function request(path: string, init?: RequestInit): Promise<SpacesMutationResult> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
  });
  if (!response.ok) {
    let message = `Spaces request failed (${response.status}).`;
    try {
      message = (await safeResponseJson(response, SpacesErrorResponse)).error;
    } catch {
      // Keep the HTTP status message when an error response is malformed.
    }
    throw new Error(message);
  }
  return safeResponseJson(response, SpacesResponse);
}

function jsonBody(body: Record<string, unknown>): RequestInit {
  return { method: "POST", body: JSON.stringify(body) };
}

function action(spaceId: string, body: Record<string, unknown>) {
  return request(`/api/spaces/${encodeURIComponent(spaceId)}/action`, jsonBody(body));
}

export async function fetchSpaceState(): Promise<PrototypeSpacesState> {
  return (await request("/api/spaces")).state;
}

export function createSpace(name: string, context: string, parentId: string | null) {
  return request("/api/spaces", {
    ...jsonBody({ name, context, parentId }),
  });
}

export function updateSpace(
  spaceId: string,
  name: string,
  context: string,
  parentId: string | null,
) {
  return action(spaceId, { action: "update", name, context, parentId });
}

export function deleteSpace(spaceId: string) {
  return action(spaceId, { action: "delete" });
}

export function archiveSpace(spaceId: string) {
  return action(spaceId, { action: "archive" });
}

export function restoreSpace(spaceId: string) {
  return action(spaceId, { action: "restore" });
}

export function moveSpace(spaceId: string, parentId: string | null) {
  return action(spaceId, { action: "move", parentId });
}

/** Persist sibling order under a shared parent. `orderedIds` must list every sibling once. */
export function reorderSpaceSiblings(spaceId: string, orderedIds: string[]) {
  return action(spaceId, { action: "reorderSiblings", orderedIds });
}

export function attachRepositoryToSpace(spaceId: string, name: string, path: string) {
  return action(spaceId, { action: "attachRepository", name, path });
}

export function releaseRepository(spaceId: string, repoId: string) {
  return action(spaceId, { action: "releaseRepository", repoId });
}

export function updateRepository(spaceId: string, repoId: string, name: string, path: string) {
  return action(spaceId, { action: "updateRepository", repoId, name, path });
}

export function discoverWorktrees(spaceId: string, repoId: string) {
  return action(spaceId, { action: "discoverWorktrees", repoId });
}

export function createWorktree(
  spaceId: string,
  repoId: string,
  branch: string,
  base: string,
  parentPath: string,
) {
  return action(spaceId, { action: "createWorktree", repoId, branch, base, parentPath });
}

export function claimWorktree(spaceId: string, repoId: string, worktree: string) {
  return action(spaceId, { action: "claimWorktree", repoId, worktree });
}

export function releaseWorktree(spaceId: string, repoId: string, worktree: string) {
  return action(spaceId, { action: "releaseWorktree", repoId, worktree });
}

export function releaseAllWorktrees(spaceId: string, repoId: string) {
  return action(spaceId, { action: "releaseAllWorktrees", repoId });
}

export function claimSession(spaceId: string, sessionId: string) {
  return action(spaceId, { action: "claimSession", sessionId });
}

export function releaseSession(spaceId: string, sessionId: string) {
  return action(spaceId, { action: "releaseSession", sessionId });
}

async function sessionRequest(path: string, init: RequestInit, fallback: string): Promise<void> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = `${fallback} (${response.status}).`;
    try {
      message = (await safeResponseJson(response, SpacesErrorResponse)).error;
    } catch {
      // Keep status message.
    }
    throw new Error(message);
  }
}

/** Archive a session globally (hides it from active space rosters). */
export function archiveSession(sessionId: string) {
  return sessionRequest(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "archived" }),
    },
    "Unable to archive session",
  );
}

/** Delete Say To Me session data (OpenCode session is kept). */
export function deleteSession(sessionId: string) {
  return sessionRequest(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
    "Unable to delete session",
  );
}

export function moveSession(sessionId: string, targetSpaceId: string) {
  return action(targetSpaceId, { action: "moveSession", sessionId });
}

export function placeSession(
  targetSpaceId: string,
  sessionId: string,
  mode: "claim" | "move",
  expectedOwnerSpaceId?: string,
) {
  const input: PlaceSessionAction = {
    action: "placeSession",
    sessionId,
    mode,
  };
  if (expectedOwnerSpaceId) input.expectedOwnerSpaceId = expectedOwnerSpaceId;
  return action(targetSpaceId, input);
}

type PlaceSessionAction = {
  action: "placeSession";
  sessionId: string;
  mode: "claim" | "move";
  expectedOwnerSpaceId?: string;
};

const DiscoveredCheckoutSchema = arktype({
  checkoutPath: "string",
  branch: "string",
  isMain: "boolean",
  repositoryIdentity: "string",
  repositoryRootPath: "string",
  repositoryName: "string",
});

const DashboardPlacementSchema = arktype({
  sessionId: "string",
  title: "string",
  cwd: "string | null",
  ownerSpaceId: "string | null",
  ownerSpaceName: "string | null",
  ownerArchived: "boolean",
  repositoryId: "string | null",
  worktreeId: "string | null",
  isMainCheckout: "boolean | null",
  placementPossible: "boolean",
  placementBlockReason:
    "'no-spaces' | 'cwd-deleted' | 'non-git' | 'owner-archived' | 'context-unresolved' | 'main-clone-ambiguous' | null",
  repairState:
    "'owner-missing' | 'owner-archived' | 'repo-detached' | 'worktree-detached' | 'context-unresolved' | 'main-clone-ambiguous' | null",
  canonicalDashboardPath: "string | null",
  needsChooser: "boolean",
  chooserMode: "'claim' | 'move' | null",
  discovered: DiscoveredCheckoutSchema.or("null"),
  preview: {
    targetSpaceId: "string | null",
    wouldAttachRepository: "boolean",
    wouldAttachWorktree: "boolean",
    warnings: "string[]",
  },
});

export type DashboardPlacement = typeof DashboardPlacementSchema.infer;

export async function fetchDashboardPlacement(
  sessionId: string,
  targetSpaceId?: string | null,
): Promise<DashboardPlacement> {
  const params = new URLSearchParams();
  if (targetSpaceId) params.set("targetSpaceId", targetSpaceId);
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/dashboard-placement${suffix}`,
  );
  if (!response.ok) {
    let message = `Dashboard placement failed (${response.status}).`;
    try {
      message = (await safeResponseJson(response, SpacesErrorResponse)).error;
    } catch {
      // Keep status message.
    }
    throw new Error(message);
  }
  return safeResponseJson(response, DashboardPlacementSchema);
}
