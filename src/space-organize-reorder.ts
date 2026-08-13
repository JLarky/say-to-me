/** Pure helpers for Organize optimistic update + rollback (unit-tested). */

export type SpaceOrderSnapshot = ReadonlyArray<{ id: string; sortOrder?: number }>;

export function applySiblingOrderOptimistic<T extends { id: string; sortOrder?: number }>(
  spaces: readonly T[],
  orderedIds: readonly string[],
): T[] {
  return spaces.map((space) => {
    const order = orderedIds.indexOf(space.id);
    return order >= 0 ? { ...space, sortOrder: order } : space;
  });
}

export function spacesAfterReorderAttempt<T>(snapshot: T, optimistic: T, succeeded: boolean): T {
  return succeeded ? optimistic : snapshot;
}
