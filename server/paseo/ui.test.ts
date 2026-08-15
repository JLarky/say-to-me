import { describe, expect, it } from "vitest";
import { paseoParkUrl } from "./ui.ts";

describe("paseoParkUrl", () => {
  it("builds a park URL without leaking TCP query credentials", () => {
    expect(
      paseoParkUrl({ id: "local", host: "tcp://paseo.example:6767?password=secret" }, "agent-1"),
    ).toBe("http://paseo.example:6767/park.html?environmentId=local&threadId=agent-1");
  });
});
