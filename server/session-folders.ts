import { sql } from "drizzle-orm";
import {
  resolveOrganizePathForSession,
  type OrganizePathCrumb,
} from "../src/session-organize-path.ts";
import { sessionFolders, sessionPlacements } from "./db/drizzle-schema.ts";
import { drizzleDb } from "./db/index.ts";

export type { OrganizePathCrumb };

export type OrgFolder = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
};

export type OrgPlacement = {
  sessionId: string;
  folderId: string | null;
  sortOrder: number;
};

export type Organization = {
  folders: OrgFolder[];
  placements: OrgPlacement[];
};

export function getOrganization(): Organization {
  const folders = drizzleDb
    .select({
      id: sessionFolders.id,
      name: sessionFolders.name,
      parentId: sessionFolders.parentId,
      sortOrder: sessionFolders.sortOrder,
    })
    .from(sessionFolders)
    .all();
  const placements = drizzleDb
    .select({
      sessionId: sessionPlacements.sessionId,
      folderId: sessionPlacements.folderId,
      sortOrder: sessionPlacements.sortOrder,
    })
    .from(sessionPlacements)
    .all();
  return { folders, placements };
}

export function getOrganizePathForSession(
  sessionId: string,
  org?: Organization,
): OrganizePathCrumb[] {
  const organization = org ?? getOrganization();
  return resolveOrganizePathForSession(sessionId, organization.folders, organization.placements);
}

/**
 * Persist the organization tree. Folders are replaced wholesale (the client
 * sends the full set). Placements are upserted per session id; placements for
 * sessions NOT in the payload are left untouched, so the organization survives
 * a session being deleted (the UI simply hides placements for missing sessions,
 * mirroring how session_notes are kept).
 */
export function saveOrganization(input: Organization): void {
  drizzleDb.transaction((tx) => {
    tx.delete(sessionFolders).run();
    for (const folder of input.folders) {
      tx.insert(sessionFolders)
        .values({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId ?? null,
          sortOrder: folder.sortOrder,
        })
        .run();
    }
    for (const placement of input.placements) {
      tx.insert(sessionPlacements)
        .values({
          sessionId: placement.sessionId,
          folderId: placement.folderId ?? null,
          sortOrder: placement.sortOrder,
        })
        .onConflictDoUpdate({
          target: sessionPlacements.sessionId,
          set: {
            folderId: placement.folderId ?? null,
            sortOrder: placement.sortOrder,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .run();
    }
  });
}
