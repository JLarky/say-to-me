// Shared activity-parsing utilities used by all external-CLI provider activity modules.
// Pure over file contents; the file read lives in the route.

import { type as arktype } from "arktype";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";

export type ActivityKind = "message" | "tool" | "thinking";

export type ActivityItem = {
  readonly kind: ActivityKind;
  readonly text: string;
  readonly tool?: string;
  readonly timestamp: number | null;
};

export type Activity = {
  readonly items: ActivityItem[];
  readonly lastTimestamp: number | null;
};

export const compact = (value: string, max = 140): string =>
  value.replace(/\s+/g, " ").trim().slice(0, max);

export const TOOL_HINT_KEYS = [
  "cmd",
  "file_path",
  "command",
  "pattern",
  "path",
  "url",
  "query",
  "description",
] as const;

/** Cursor CreatePlan tool input from untrusted transcript JSON. */
export const CreatePlanInput = arktype({
  "name?": "string",
  "overview?": "string",
  "plan?": "string",
  "todos?": [
    {
      "id?": "string",
      "content?": "string",
    },
    "[]",
  ],
});
export type CreatePlanInput = typeof CreatePlanInput.infer;

/** Cursor AskQuestion tool input from untrusted transcript JSON. */
export const AskQuestionInput = arktype({
  "title?": "string",
  "questions?": [
    {
      "id?": "string",
      "prompt?": "string",
      "options?": [
        {
          "id?": "string",
          "label?": "string",
        },
        "[]",
      ],
    },
    "[]",
  ],
});
export type AskQuestionInput = typeof AskQuestionInput.infer;

// oxlint-disable-next-line anti-slop/no-unknown-returns -- This preserves opaque transcript input for the generic tool hint formatter; named tool schemas validate before inspection.
function coerceToolInput(input: unknown): unknown {
  if (typeof input === "string") return safeJsonParse(UnknownJson, input);
  return input;
}

function formatCreatePlanSummary(io: CreatePlanInput): string {
  const title = io.name?.trim() ?? "";
  const overview = io.overview?.trim() ?? "";
  const plan = io.plan?.trim() ?? "";
  const todos = (io.todos ?? []).flatMap((todo) => {
    const content = todo.content?.trim();
    return content ? [`- [ ] ${content}`] : [];
  });

  const parts: string[] = [title ? `**CreatePlan:** ${title}` : "**CreatePlan**"];
  if (overview) parts.push(overview);
  if (plan) parts.push(plan);
  if (todos.length > 0) parts.push(["## Todos", ...todos].join("\n"));
  return parts.join("\n\n");
}

function formatAskQuestionSummary(io: AskQuestionInput): string {
  const title = io.title?.trim() ?? "";
  const parts: string[] = [title ? `**AskQuestion:** ${title}` : "**AskQuestion**"];

  for (const question of io.questions ?? []) {
    const prompt = question.prompt?.trim() ?? "";
    if (prompt) parts.push(prompt);
    const options = (question.options ?? []).flatMap((option) => {
      const label = option.label?.trim();
      return label ? [`- ${label}`] : [];
    });
    if (options.length > 0) parts.push(options.join("\n"));
  }

  return parts.length > 1 ? parts.join("\n\n") : (parts[0] ?? "AskQuestion");
}

export function toolSummary(name: string, input: unknown): string {
  const raw = coerceToolInput(input);

  if (name === "CreatePlan") {
    const parsed = CreatePlanInput(raw);
    if (parsed instanceof arktype.errors) return name;
    return formatCreatePlanSummary(parsed);
  }

  if (name === "AskQuestion") {
    const parsed = AskQuestionInput(raw);
    if (parsed instanceof arktype.errors) return name;
    return formatAskQuestionSummary(parsed);
  }

  let io: Record<string, unknown> | null = null;
  if (typeof input === "string") {
    if (raw === null) return compact(`${name} ${input}`, 120);
    if (raw && typeof raw === "object") io = raw as Record<string, unknown>;
  } else if (input && typeof input === "object") {
    io = input as Record<string, unknown>;
  }
  const hint = io
    ? TOOL_HINT_KEYS.map((key) => io![key]).find((value) => typeof value === "string")
    : undefined;
  return typeof hint === "string" ? `${name} ${compact(hint, 80)}` : name;
}

export function textFromContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts = content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const candidate = block as { type?: unknown; text?: unknown };
    return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
  });
  const text = parts.join("\n").trim();
  return text || null;
}

export function parseTimestamp(raw: unknown): number | null {
  const parsed = typeof raw === "string" ? Date.parse(raw) : NaN;
  return Number.isNaN(parsed) ? null : parsed;
}
