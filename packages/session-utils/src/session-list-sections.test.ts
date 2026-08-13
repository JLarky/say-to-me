import { describe, expect, it } from "vite-plus/test";
import { sessionListSections } from "./session-list-sections.ts";

describe("sessionListSections", () => {
  it("partitions Jarvis, important, general, and archived in homepage order", () => {
    const sections = sessionListSections([
      { id: "ses_general", state: "general" },
      { id: "ses_archived", state: "archived" },
      { id: "ses_important", state: "important" },
      { id: "ses_jarvis", state: "jarvis" },
      { id: "ses_default" },
    ]);

    expect(sections.jarvis.map((session) => session.id)).toEqual(["ses_jarvis"]);
    expect(sections.important.map((session) => session.id)).toEqual(["ses_important"]);
    expect(sections.general.map((session) => session.id)).toEqual(["ses_general", "ses_default"]);
    expect(sections.archived.map((session) => session.id)).toEqual(["ses_archived"]);
  });
});
