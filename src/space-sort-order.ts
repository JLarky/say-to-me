/** Sibling + tree ordering for spaces (shared by dashboard UI and server). */

export type SpaceSortFields = {
  id: string;
  name: string;
  parentId: string | null;
  archived?: boolean;
  sortOrder?: number;
};

export function compareSpacesBySortOrder(a: SpaceSortFields, b: SpaceSortFields): number {
  const aOrder = a.sortOrder ?? 0;
  const bOrder = b.sortOrder ?? 0;
  if (aOrder !== bOrder) return aOrder - bOrder;
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

export function sortSpacesBySortOrder<T extends SpaceSortFields>(spaces: T[]): T[] {
  return [...spaces].sort(compareSpacesBySortOrder);
}

/**
 * Flatten spaces in Organize / tree order: each sibling group sorted by
 * sortOrder, then depth-first children. Avoids globally sorting roots with
 * children by the same numeric sortOrder (picker divergence).
 */
export function flattenSpacesDepthFirst<T extends SpaceSortFields>(
  spaces: readonly T[],
  options?: { includeArchived?: boolean },
): T[] {
  const includeArchived = options?.includeArchived ?? false;
  const visible = includeArchived ? [...spaces] : spaces.filter((space) => !space.archived);
  const byParent = new Map<string | null, T[]>();
  for (const space of visible) {
    const key = space.parentId ?? null;
    const list = byParent.get(key);
    if (list) list.push(space);
    else byParent.set(key, [space]);
  }
  for (const list of byParent.values()) list.sort(compareSpacesBySortOrder);

  const out: T[] = [];
  function walk(parentId: string | null) {
    for (const space of byParent.get(parentId) ?? []) {
      out.push(space);
      walk(space.id);
    }
  }
  walk(null);
  return out;
}

/** First active space in canonical Organize order (dashboard default / redirects). */
export function firstActiveSpaceId(spaces: readonly SpaceSortFields[]): string {
  return flattenSpacesDepthFirst(spaces)[0]?.id ?? "";
}
