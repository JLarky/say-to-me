export type OrganizePathCrumb = {
  id: string;
  name: string;
};

/** Sentinel id for the organize root crumb (links to /organize, not /organize/:id). */
export const ORGANIZE_ROOT_CRUMB_ID = "__root__";

export const ORGANIZE_ROOT_CRUMB: OrganizePathCrumb = {
  id: ORGANIZE_ROOT_CRUMB_ID,
  name: "Home",
};

type OrganizeFolder = {
  id: string;
  name: string;
  parentId: string | null;
};

type OrganizePlacement = {
  sessionId: string;
  folderId: string | null;
};

/** Folder names from root to the session's parent folder. Root sessions get a Home crumb. */
export function resolveOrganizePathForSession(
  sessionId: string,
  folders: OrganizeFolder[],
  placements: OrganizePlacement[],
): OrganizePathCrumb[] {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const placement = placements.find((entry) => entry.sessionId === sessionId);
  if (!placement?.folderId) return [ORGANIZE_ROOT_CRUMB];

  const crumbs: OrganizePathCrumb[] = [];
  const seen = new Set<string>();
  let cursor = folderById.get(placement.folderId);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    crumbs.unshift({ id: cursor.id, name: cursor.name });
    cursor = cursor.parentId ? folderById.get(cursor.parentId) : undefined;
  }
  return crumbs;
}

export function formatOrganizePath(crumbs: OrganizePathCrumb[]): string {
  return crumbs.map((crumb) => crumb.name).join(" / ");
}
