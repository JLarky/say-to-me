import { describe, expect, it } from "vite-plus/test";

import {
  applySiblingOrderOptimistic,
  spacesAfterReorderAttempt,
} from "./space-organize-reorder.ts";
import {
  firstActiveSpaceId,
  flattenSpacesDepthFirst,
  sortSpacesBySortOrder,
  type SpaceSortFields,
} from "./space-sort-order.ts";

function space(
  overrides: Partial<SpaceSortFields> & Pick<SpaceSortFields, "id" | "name">,
): SpaceSortFields {
  return {
    parentId: null,
    archived: false,
    sortOrder: 0,
    ...overrides,
  };
}

describe("space sort order helpers", () => {
  it("orders siblings by sortOrder then name then id", () => {
    const sorted = sortSpacesBySortOrder([
      space({ id: "b", name: "Beta", sortOrder: 2 }),
      space({ id: "a", name: "Alpha", sortOrder: 0 }),
      space({ id: "c", name: "Charlie", sortOrder: 1 }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["a", "c", "b"]);
  });

  it("flattens roots and nested children depth-first without mixing sibling groups", () => {
    // Child sortOrder=0 must not sort ahead of a root with sortOrder=1.
    const flat = flattenSpacesDepthFirst([
      space({ id: "root-b", name: "Root B", sortOrder: 1 }),
      space({ id: "root-a", name: "Root A", sortOrder: 0 }),
      space({ id: "child-b", name: "Child B", parentId: "root-a", sortOrder: 1 }),
      space({ id: "child-a", name: "Child A", parentId: "root-a", sortOrder: 0 }),
      space({ id: "child-root-b", name: "Under B", parentId: "root-b", sortOrder: 0 }),
    ]);
    expect(flat.map((item) => item.id)).toEqual([
      "root-a",
      "child-a",
      "child-b",
      "root-b",
      "child-root-b",
    ]);
  });

  it("picks the first active space in canonical DFS order", () => {
    expect(
      firstActiveSpaceId([
        space({ id: "archived-root", name: "Z", sortOrder: 0, archived: true }),
        space({ id: "root-b", name: "B", sortOrder: 1 }),
        space({ id: "root-a", name: "A", sortOrder: 0 }),
        space({ id: "nested", name: "Nested", parentId: "root-a", sortOrder: 0 }),
      ]),
    ).toBe("root-a");
  });
});

describe("organize reorder optimistic rollback", () => {
  it("restores the snapshot when a reorder mutation is rejected", () => {
    const snapshot = [
      space({ id: "a", name: "A", sortOrder: 0 }),
      space({ id: "b", name: "B", sortOrder: 1 }),
    ];
    const optimistic = applySiblingOrderOptimistic(snapshot, ["b", "a"]);
    expect(optimistic.map((item) => item.sortOrder)).toEqual([1, 0]);
    expect(spacesAfterReorderAttempt(snapshot, optimistic, false)).toBe(snapshot);
    expect(spacesAfterReorderAttempt(snapshot, optimistic, true)).toBe(optimistic);
  });
});
