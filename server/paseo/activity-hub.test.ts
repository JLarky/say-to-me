import { describe, expect, it } from "vitest";
import { getPaseoActivitySnapshot } from "./activity-hub.ts";

describe("Paseo activity hub", () => {
  it("rejects Paseo Chat room ids", async () => {
    await expect(
      getPaseoActivitySnapshot("pc_11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow("Not a Paseo session.");
  });
});
