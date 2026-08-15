import { describe, expect, it } from "vitest";
import { stopPaseoSession } from "./stop.ts";

describe("stopPaseoSession", () => {
  it("rejects Paseo Chat room ids", async () => {
    await expect(stopPaseoSession("pc_11111111-1111-4111-8111-111111111111")).resolves.toEqual({
      ok: false,
      status: 400,
      error: "Invalid Paseo session id.",
    });
  });
});
