import { describe, expect, it } from "vite-plus/test";
import {
  buildPaseoAgentNameMap,
  resolvePaseoAgentLabel,
  shortPaseoAgentId,
  speechTextWithAgentNames,
  splitTextWithPaseoMentions,
  uniquePaseoMentionsInText,
} from "./paseo-mentions.ts";

const e2e = "8f70ea38-319a-478a-92b2-2c3cd13f35cf";
const effect = "45f60d0d-2d76-49ca-9509-9c1bc77cc95f";
const self = "2427004a-6974-49c8-a339-958686a4fd5d";

describe("paseo mentions prototype", () => {
  it("matches Paseo UI short id (first 7 characters)", () => {
    expect(shortPaseoAgentId(self)).toBe("2427004");
  });

  it("prefers display name then short id", () => {
    const names = new Map([[self.toLowerCase(), "STM paseo chat"]]);
    expect(resolvePaseoAgentLabel(self, names)).toEqual({
      id: self,
      label: "STM paseo chat",
      kind: "name",
    });
    expect(resolvePaseoAgentLabel(effect)).toEqual({
      id: effect,
      label: "45f60d0",
      kind: "short",
    });
  });

  it("builds a name map from author badges", () => {
    const map = buildPaseoAgentNameMap([
      { paseoAuthor: self, paseoAuthorName: "STM paseo chat" },
      { paseoAuthor: effect, paseoAuthorName: "Effect expert" },
      { paseoAuthor: "manual", paseoAuthorName: null },
    ]);
    expect(map.get(self)).toBe("STM paseo chat");
    expect(map.get(effect)).toBe("Effect expert");
  });

  it("rewrites speech with names or short ids (never full uuid when matched)", () => {
    const names = { [e2e]: "STM paseo chat e2e", [effect]: "Effect expert" };
    const raw = `@${e2e} @${effect} Draft PR. @${self} note.`;
    expect(speechTextWithAgentNames(raw, names)).toBe(
      "STM paseo chat e2e Effect expert Draft PR. 2427004 note.",
    );
  });

  it("splits body text into text and mention chip parts", () => {
    const parts = splitTextWithPaseoMentions(`Hi @${self} please look`, {
      [self]: "STM paseo chat",
    });
    expect(parts).toEqual([
      { type: "text", value: "Hi " },
      {
        type: "mention",
        id: self,
        label: "STM paseo chat",
        kind: "name",
      },
      { type: "text", value: " please look" },
    ]);
  });

  it("lists unique mention cards in document order", () => {
    const cards = uniquePaseoMentionsInText(`@${effect} then @${self} then @${effect} again`, {
      [effect]: "Effect expert",
    });
    expect(cards.map((c) => c.label)).toEqual(["Effect expert", "2427004"]);
  });
});
