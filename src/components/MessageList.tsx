import React from "react";
import * as stylex from "@stylexjs/stylex";

import { MessageRow } from "./MessageRow.tsx";
import type { Message } from "../types.ts";

const thread = stylex.create({
  list: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    rowGap: "0.85rem",
    columnGap: "0.85rem",
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
});

export function MessageList({
  messages,
  onDelete,
  onInsertSessionMention,
  onTogglePinned = () => {},
  onPlay,
  onRetryPendingMessage = () => {},
  onRetryDelivery = () => {},
  onStop,
  speakingId,
}: {
  messages: Message[];
  onDelete: (message: Message) => void;
  onInsertSessionMention?: (token: string) => void;
  onTogglePinned?: (message: Message) => void;
  onPlay: (message: Message) => void;
  onRetryPendingMessage?: (message: Message) => void;
  onRetryDelivery?: (message: Message) => void;
  onStop: (message: Message) => void;
  speakingId: number | null;
}) {
  return (
    <ol {...stylex.props(thread.list)}>
      {messages.map((message) => (
        <MessageRow
          key={message.id}
          messages={messages}
          message={message}
          onDelete={onDelete}
          onInsertSessionMention={onInsertSessionMention}
          onTogglePinned={onTogglePinned}
          onPlay={onPlay}
          onRetryPendingMessage={onRetryPendingMessage}
          onRetryDelivery={onRetryDelivery}
          onStop={onStop}
          speakingId={speakingId}
        />
      ))}
    </ol>
  );
}

export const ThreadList = MessageList;
