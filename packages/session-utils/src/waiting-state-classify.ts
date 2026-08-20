export type WaitingStateClassifyStatus = string | null;

export type WaitingStateClassifyMessage = {
  author: "agent" | "user";
  text: string;
  opencodeDeliveryStatus: string | null;
};

export type WaitingStateClassifyInput = {
  opencodeStatus: WaitingStateClassifyStatus;
  /** Finer-grained activity status from the activity preview (e.g. "awaiting-input"). */
  activityStatus?: string | null;
  messages: WaitingStateClassifyMessage[];
};

export type WaitingStateClassifyPayload = {
  state:
    | "needs_answer"
    | "needs_direction"
    | "can_continue"
    | "working"
    | "blocked"
    | "review"
    | "unknown";
  reason: string;
  action?: string;
};

export function classifyWaitingState(
  input: WaitingStateClassifyInput,
): WaitingStateClassifyPayload {
  const latest = input.messages.at(-1);
  if (!latest) {
    return { state: "unknown", reason: "No messages in this session yet." };
  }

  if (latest.author === "user") {
    const delivery = latest.opencodeDeliveryStatus;
    const userMsgStatus = (input.opencodeStatus ?? "").toLowerCase();
    if (userMsgStatus === "unavailable" || userMsgStatus === "unreachable") {
      return { state: "unknown", reason: "OpenCode is unavailable for this session." };
    }
    if (delivery === "cli_unconfirmed") {
      return {
        state: "blocked",
        reason: "The last message reached the CLI, but the delivery was never confirmed.",
        action: "Check the session before resending",
      };
    }
    if (delivery === "failed" || delivery === "cli_timed_out") {
      return {
        state: "blocked",
        reason: "The last message failed to deliver to OpenCode.",
        action: "Retry delivery",
      };
    }
    if (delivery === "pending" || input.opencodeStatus === "pending") {
      return { state: "working", reason: "The agent is working on the last message." };
    }
    return { state: "working", reason: "The agent is working on the last message." };
  }

  if (input.opencodeStatus === "pending") {
    if (input.activityStatus === "awaiting-input") {
      return {
        state: "needs_answer",
        reason: "OpenCode is waiting for your answer to a question.",
        action: "Answer question in OpenCode",
      };
    }
    return { state: "working", reason: "The agent is still working." };
  }
  if (input.opencodeStatus === "idle") {
    if (endsWithQuestion(latest.text)) {
      return {
        state: "needs_answer",
        reason: "The agent asked a question and is now idle.",
        action: "Answer question",
      };
    }
    return {
      state: "can_continue",
      reason: "The agent reported back and is now idle.",
      action: "Send please continue",
    };
  }

  const status = (input.opencodeStatus ?? "").toLowerCase();
  if (status === "unavailable" || status === "unreachable") {
    return { state: "unknown", reason: "OpenCode status is unavailable for this session." };
  }

  // Other / missing OpenCode statuses — infer from the last agent message.
  if (endsWithQuestion(latest.text)) {
    return {
      state: "needs_answer",
      reason: "The agent asked a question.",
      action: "Answer question",
    };
  }
  return {
    state: "can_continue",
    reason: "The agent reported back.",
    action: "Send please continue",
  };
}

function endsWithQuestion(text: string): boolean {
  const lastLine = text.trimEnd().split("\n").at(-1)?.trim() ?? "";
  return lastLine.endsWith("?");
}
