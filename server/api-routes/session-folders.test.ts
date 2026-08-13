import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

const testDbDir = mkdtempSync(path.join(tmpdir(), "say-to-me-session-folders-test-"));
process.env.SAY_TO_ME_DB = path.join(testDbDir, "queue.sqlite");

const { parseOrganization } = await import("./session-folders.ts");
const { getOrganization, saveOrganization } = await import("../session-folders.ts");
const { drizzleSqlite } = await import("../db/index.ts");

describe("parseOrganization", () => {
  it("accepts a valid tree", () => {
    const input = {
      folders: [{ id: "f1", name: "Work", parentId: null, sortOrder: 0 }],
      placements: [{ sessionId: "ses_ff03000e647805ix8IqxyDL5i7", folderId: "f1", sortOrder: 0 }],
    };
    expect(parseOrganization(input)).toEqual(input);
  });

  it("rejects a non-object or missing arrays", () => {
    expect(parseOrganization(null)).toBeNull();
    expect(parseOrganization({ folders: [] })).toBeNull();
    expect(parseOrganization({ folders: [], placements: {} })).toBeNull();
  });

  it("rejects a folder missing id/name", () => {
    expect(parseOrganization({ folders: [{ id: "f1", sortOrder: 0 }], placements: [] })).toBeNull();
  });

  it("coerces a non-string parentId/folderId to null", () => {
    const r = parseOrganization({
      folders: [{ id: "f1", name: "A", parentId: 5, sortOrder: 0 }],
      placements: [{ sessionId: "s", folderId: {}, sortOrder: 0 }],
    });
    expect(r?.folders[0]?.parentId).toBeNull();
    expect(r?.placements[0]?.folderId).toBeNull();
  });

  it("rejects a non-finite sortOrder", () => {
    expect(
      parseOrganization({
        folders: [{ id: "f1", name: "A", parentId: null, sortOrder: Number.NaN }],
        placements: [],
      }),
    ).toBeNull();
    expect(
      parseOrganization({
        folders: [],
        placements: [{ sessionId: "s", folderId: null, sortOrder: Number.NaN }],
      }),
    ).toBeNull();
  });

  it("rejects a self-parent folder", () => {
    expect(
      parseOrganization({
        folders: [{ id: "f1", name: "A", parentId: "f1", sortOrder: 0 }],
        placements: [],
      }),
    ).toBeNull();
  });

  it("rejects a folder cycle", () => {
    expect(
      parseOrganization({
        folders: [
          { id: "a", name: "A", parentId: "b", sortOrder: 0 },
          { id: "b", name: "B", parentId: "a", sortOrder: 1 },
        ],
        placements: [],
      }),
    ).toBeNull();
  });

  it("accepts a dangling parent (resolved on read, not rejected here)", () => {
    const r = parseOrganization({
      folders: [{ id: "f1", name: "A", parentId: "ghost", sortOrder: 0 }],
      placements: [],
    });
    expect(r?.folders[0]?.parentId).toBe("ghost");
  });
});

describe("saveOrganization", () => {
  afterAll(() => {
    drizzleSqlite.close();
    rmSync(testDbDir, { force: true, recursive: true });
  });

  it("keeps placements omitted from a later save (deletion survival)", () => {
    saveOrganization({
      folders: [{ id: "f1", name: "Work", parentId: null, sortOrder: 0 }],
      placements: [
        { sessionId: "ses_f1e7bc62db97ycj0td35pGuaB8", folderId: "f1", sortOrder: 0 },
        { sessionId: "ses_80f3dc246c8dNuQFpEeVRwWlvi", folderId: "f1", sortOrder: 1 },
      ],
    });
    // A later save that no longer knows about ses_80f3dc246c8dNuQFpEeVRwWlvi (deleted/hidden) must not drop it.
    saveOrganization({
      folders: [{ id: "f1", name: "Work", parentId: null, sortOrder: 0 }],
      placements: [{ sessionId: "ses_f1e7bc62db97ycj0td35pGuaB8", folderId: "f1", sortOrder: 0 }],
    });
    const ids = getOrganization().placements.map((p) => p.sessionId);
    expect(ids).toContain("ses_f1e7bc62db97ycj0td35pGuaB8");
    expect(ids).toContain("ses_80f3dc246c8dNuQFpEeVRwWlvi");
  });

  it("replaces folders wholesale and upserts placements", () => {
    saveOrganization({
      folders: [
        { id: "a", name: "A", parentId: null, sortOrder: 0 },
        { id: "b", name: "B", parentId: null, sortOrder: 1 },
      ],
      placements: [{ sessionId: "ses_8886bd8332a90m7oeesrWkehJm", folderId: "a", sortOrder: 0 }],
    });
    saveOrganization({
      folders: [{ id: "a", name: "A2", parentId: null, sortOrder: 0 }],
      placements: [{ sessionId: "ses_8886bd8332a90m7oeesrWkehJm", folderId: "a", sortOrder: 3 }],
    });
    const org = getOrganization();
    expect(org.folders.map((f) => f.id)).toContain("a");
    expect(org.folders.map((f) => f.id)).not.toContain("b");
    expect(org.folders.find((f) => f.id === "a")?.name).toBe("A2");
    const moved = org.placements.find((p) => p.sessionId === "ses_8886bd8332a90m7oeesrWkehJm");
    expect(moved?.folderId).toBe("a");
    expect(moved?.sortOrder).toBe(3);
  });
});
