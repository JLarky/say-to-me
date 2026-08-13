import { type } from "arktype";
import { Duration, Effect } from "effect";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WaitingStatePayload } from "../../src/types.ts";
import type { WaitingStateInput } from "../waiting-state.ts";
import { createOpenCodeClient, openCodeBaseUrl } from "./http.ts";

const jinxTimeoutMs = Number(process.env.SAY_TO_ME_JINX_TIMEOUT_MS || 30_000);
const scratchDirectory = path.join(tmpdir(), "say-to-me-jinx");
const maxMessageChars = 600;

export function isJinxEnabled(): boolean {
  return process.env.SAY_TO_ME_JINX === "1" || process.env.SAY_TO_ME_JINX === "true";
}

const JinxClassification = type({
  state: type.enumerated(
    "needs_answer" as const,
    "needs_direction" as const,
    "can_continue" as const,
    "blocked" as const,
    "review" as const,
  ),
  reason: "string",
  "action?": "string",
});

const jinxOutputSchema = JinxClassification.toJsonSchema() as Record<string, unknown>;

const jinxSystemPrompt = [
  "You are Jinx, a classifier for a voice-first inbox of coding-agent sessions.",
  "Given the recent conversation between a user and a coding agent, plus the",
  "agent's runtime status, decide what the user should do next. Labels:",
  "- needs_answer: the agent asked a question only the user can answer.",
  "- needs_direction: the agent finished or stalled and the user must choose what happens next.",
  "- can_continue: the agent paused mid-task and simply telling it to continue is enough.",
  "- blocked: the agent is stuck on an external problem (failing tools, CI, permissions, missing access).",
  "- review: the agent completed the task and the result is waiting for the user to review.",
  "Set reason to one short sentence a user can hear read aloud, and action to a",
  "short imperative suggestion (5 words or fewer). Respond only with the",
  "structured output.",
].join("\n");

function buildJinxPrompt(input: WaitingStateInput): string {
  const transcript = input.messages
    .map((message) => `${message.author}: ${truncate(message.text)}`)
    .join("\n---\n");
  return [
    `Agent runtime status: ${input.opencodeStatus ?? "unknown"} (pending means busy).`,
    "Recent session messages, oldest first:",
    transcript,
    "Classify what the user should do next.",
  ].join("\n\n");
}

function truncate(text: string): string {
  return text.length > maxMessageChars ? `${text.slice(0, maxMessageChars)}…` : text;
}

function jinxModel(): { providerID: string; modelID: string } | null {
  const raw = process.env.SAY_TO_ME_JINX_MODEL;
  if (!raw) return null;
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) return null;
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) };
}

export function classifyWithJinx(input: WaitingStateInput): Promise<WaitingStatePayload | null> {
  const baseUrl = openCodeBaseUrl();
  const client = createOpenCodeClient(baseUrl);

  const createSession = Effect.tryPromise(async () => {
    mkdirSync(scratchDirectory, { recursive: true });
    const created = await client.session.create({ directory: scratchDirectory });
    const id = created.data?.id;
    if (
      !created.response ||
      created.response.status < 200 ||
      created.response.status >= 300 ||
      !id
    ) {
      throw new Error(
        created.response
          ? `OpenCode session create returned HTTP ${created.response.status}`
          : "OpenCode session create did not return an HTTP response",
      );
    }
    return id;
  });

  const promptSession = (sessionID: string) =>
    Effect.tryPromise(async () => {
      const model = jinxModel();
      const result = await client.session.prompt({
        sessionID,
        directory: scratchDirectory,
        agent: "plan",
        ...(model ? { model } : {}),
        system: jinxSystemPrompt,
        format: { type: "json_schema", schema: jinxOutputSchema, retryCount: 1 },
        parts: [{ type: "text", text: buildJinxPrompt(input) }],
      });
      if (!result.response || result.response.status < 200 || result.response.status >= 300) {
        throw new Error(
          result.response
            ? `OpenCode prompt returned HTTP ${result.response.status}`
            : "OpenCode prompt did not return an HTTP response",
        );
      }
      const classification = JinxClassification.assert(result.data?.info?.structured);
      return { ...classification, source: "jinx" as const };
    });

  const removeSession = (sessionID: string) =>
    Effect.promise(() =>
      client.session.delete({ sessionID, directory: scratchDirectory }).catch(() => null),
    );

  const program = Effect.acquireUseRelease(createSession, promptSession, removeSession).pipe(
    Effect.timeoutFail({
      duration: Duration.millis(jinxTimeoutMs),
      onTimeout: () => new Error(`Jinx classification timed out after ${jinxTimeoutMs}ms`),
    }),
    Effect.tapError((error) =>
      Effect.sync(() => console.error("[jinx] classification failed:", error.message)),
    ),
    Effect.orElseSucceed((): WaitingStatePayload | null => null),
  );

  return Effect.runPromise(program);
}
