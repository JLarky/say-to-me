import { describe, expect, it } from "vite-plus/test";
import { AskQuestionInput, CreatePlanInput, toolSummary } from "./activity-parsing.ts";
import { type as arktype } from "arktype";

describe("toolSummary", () => {
  it("keeps short tool hints for common keys", () => {
    expect(toolSummary("Read", { file_path: "/tmp/a.ts" })).toBe("Read /tmp/a.ts");
    expect(toolSummary("Grep", { pattern: "preferredWorktree" })).toBe("Grep preferredWorktree");
  });

  it("renders CreatePlan name, overview, plan, and todos as markdown", () => {
    const summary = toolSummary("CreatePlan", {
      name: "Jarvis location settings",
      overview: "Add a preferred Jarvis parent path setting.",
      plan: "# Jarvis location settings\n\n## Approach\n\nMirror the worktree preference.",
      todos: [
        { id: "db-column", content: "Add preferredJarvisParentPath to app_settings" },
        { id: "settings-ui", content: "Add Jarvis location form section" },
      ],
    });

    expect(summary).toContain("**CreatePlan:** Jarvis location settings");
    expect(summary).toContain("Add a preferred Jarvis parent path setting.");
    expect(summary).toContain("# Jarvis location settings");
    expect(summary).toContain("## Todos");
    expect(summary).toContain("- [ ] Add preferredJarvisParentPath to app_settings");
    expect(summary).toContain("- [ ] Add Jarvis location form section");
  });

  it("renders AskQuestion prompts and options as markdown", () => {
    const summary = toolSummary("AskQuestion", {
      title: "Jarvis location setting",
      questions: [
        {
          id: "blank_behavior",
          prompt: "When blank, what should Create Jarvis Session do?",
          options: [
            { id: "default_home", label: "Use ~/.say-to-me/jarvis" },
            { id: "keep_legacy", label: "Keep today's path" },
          ],
        },
      ],
    });

    expect(summary).toContain("**AskQuestion:** Jarvis location setting");
    expect(summary).toContain("When blank, what should Create Jarvis Session do?");
    expect(summary).toContain("- Use ~/.say-to-me/jarvis");
    expect(summary).toContain("- Keep today's path");
  });

  it("falls back to the tool name for malformed CreatePlan and AskQuestion payloads", () => {
    expect(toolSummary("CreatePlan", null)).toBe("CreatePlan");
    expect(toolSummary("CreatePlan", "not-json")).toBe("CreatePlan");
    expect(toolSummary("CreatePlan", 12)).toBe("CreatePlan");
    expect(toolSummary("CreatePlan", { name: 12, todos: "nope" })).toBe("CreatePlan");
    expect(toolSummary("CreatePlan", { todos: [{ content: 9 }] })).toBe("CreatePlan");
    expect(toolSummary("AskQuestion", { title: true })).toBe("AskQuestion");
    expect(toolSummary("AskQuestion", { questions: { prompt: "x" } })).toBe("AskQuestion");
    expect(toolSummary("AskQuestion", { questions: [{ options: "x" }] })).toBe("AskQuestion");
  });

  it("still formats partial CreatePlan and AskQuestion payloads", () => {
    expect(toolSummary("CreatePlan", {})).toBe("**CreatePlan**");
    expect(toolSummary("CreatePlan", { name: "Only title" })).toBe("**CreatePlan:** Only title");
    expect(toolSummary("CreatePlan", { plan: "# Just the plan" })).toContain("# Just the plan");
    expect(
      toolSummary("CreatePlan", { todos: [{ id: "a" }, { content: " Do thing " }] }),
    ).toContain("- [ ] Do thing");

    expect(toolSummary("AskQuestion", {})).toBe("**AskQuestion**");
    expect(toolSummary("AskQuestion", { title: "Only title" })).toBe("**AskQuestion:** Only title");
    expect(
      toolSummary("AskQuestion", {
        questions: [{ prompt: "Pick one", options: [{ id: "a" }, { label: " Alpha " }] }],
      }),
    ).toContain("- Alpha");
  });

  it("accepts CreatePlan and AskQuestion JSON string inputs via schema validation", () => {
    const createPlan = toolSummary(
      "CreatePlan",
      JSON.stringify({ name: "From JSON", overview: "Overview only" }),
    );
    expect(createPlan).toContain("**CreatePlan:** From JSON");
    expect(createPlan).toContain("Overview only");

    const ask = toolSummary(
      "AskQuestion",
      JSON.stringify({ title: "From JSON", questions: [{ prompt: "Yes?" }] }),
    );
    expect(ask).toContain("**AskQuestion:** From JSON");
    expect(ask).toContain("Yes?");
  });
});

describe("CreatePlanInput / AskQuestionInput schemas", () => {
  it("rejects malformed nested fields and non-objects", () => {
    expect(CreatePlanInput({ todos: "bad" }) instanceof arktype.errors).toBe(true);
    expect(CreatePlanInput(null) instanceof arktype.errors).toBe(true);
    expect(CreatePlanInput(12) instanceof arktype.errors).toBe(true);
    expect(AskQuestionInput({ questions: [{ options: 1 }] }) instanceof arktype.errors).toBe(true);
    expect(AskQuestionInput("x") instanceof arktype.errors).toBe(true);
  });

  it("accepts partial payloads", () => {
    expect(CreatePlanInput({ name: "x" })).toEqual({ name: "x" });
    expect(AskQuestionInput({ questions: [{ prompt: "q" }] })).toEqual({
      questions: [{ prompt: "q" }],
    });
  });
});
