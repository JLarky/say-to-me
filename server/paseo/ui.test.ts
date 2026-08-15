import { describe, expect, it } from "vitest";
import { paseoAgentUrl } from "./ui.ts";

describe("paseoAgentUrl", () => {
  it("builds the Paseo agent URL on localhost", () => {
    expect(
      paseoAgentUrl(
        { id: "local", serverId: "srv_Cn6tsVkA1tPv", host: "tcp://127.0.0.1:6767?password=secret" },
        "917a2992-7550-4fd7-a0f1-3d1f20dfa7f2",
      ),
    ).toBe("http://localhost:6767/h/srv_Cn6tsVkA1tPv/agent/917a2992-7550-4fd7-a0f1-3d1f20dfa7f2");
  });
});
