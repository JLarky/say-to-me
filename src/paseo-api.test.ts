import { describe, expect, it } from "vite-plus/test";
import { unclaimedPaseoImportSessions } from "./paseo-api.ts";

describe("unclaimedPaseoImportSessions", () => {
  it("keeps only sessions not already imported", () => {
    const base = { chatId: "1", title: null, modifiedAt: null, instanceId: "default", cwd: null };
    expect(
      unclaimedPaseoImportSessions([
        { ...base, sessionId: "pa_one", imported: false },
        { ...base, sessionId: "pa_two", imported: true },
      ]),
    ).toHaveLength(1);
  });
});
