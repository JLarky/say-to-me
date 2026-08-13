import React, { useMemo } from "react";
import { Link } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { SafeHtml } from "./SafeHtml.tsx";
import { OpenCodeStatusBadge } from "./SessionStatusControls.tsx";
import { sessionMentionToken } from "../session-mentions.ts";
import { sessionListLabel } from "../session-label.ts";
import {
  buildPaseoAgentNameMap,
  shortPaseoAgentId,
  splitTextWithPaseoMentions,
  uniquePaseoMentionsInText,
} from "../paseo-mentions.ts";
import { controls } from "../styles/controls.stylex.ts";
import { badge, queue } from "../styles/feed.stylex.ts";
import type { Message, OpenCodeStatus } from "../types.ts";
import { formatMessageTime, playedStatuses } from "../utils.ts";
import {
  cardStatusLabel,
  deliveryProviderLabel,
  deliveryStatusLabel,
  deliveryStatusSet,
  forwardDetail,
  idleNotificationSessionId,
  systemMessageText,
  type DeliveryStatusValue,
} from "../message-delivery.ts";

const mobile = "@media (max-width: 680px)" as const;

const deliveryBadge = stylex.create({
  warning: { backgroundColor: "#fef0c7", color: "#93370d" },
  success: { backgroundColor: "#dcfae6", color: "#067647" },
  error: { backgroundColor: "#fee4e2", color: "#b42318" },
});

function getDeliveryBadge(status: DeliveryStatusValue) {
  switch (status) {
    case "sent":
      return deliveryBadge.success;
    case "failed":
      return deliveryBadge.error;
    case "queued":
    case "pending":
    case "cli_timed_out":
      return deliveryBadge.warning;
  }
}

function getDeliveryDetailTone(status: DeliveryStatusValue | null) {
  return status === "cli_timed_out" ? delivery.detailWarning : delivery.detailError;
}

const authorBadge = stylex.create({
  agent: { backgroundColor: "#fef0c7", color: "#93370d" },
  user: { backgroundColor: "#dbeafe", color: "#175cd3" },
  paseo: { backgroundColor: "#f4ebff", color: "#6d28d9" },
});

/** Prototype: in-body @agent chips + thin mention cards (name → short id). */
const mentionUi = stylex.create({
  chip: {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "999px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(109, 40, 217, 0.28)",
    backgroundColor: "#f4ebff",
    color: "#6d28d9",
    fontSize: "0.92em",
    fontWeight: 600,
    paddingBlock: "0.05rem",
    paddingInline: "0.45rem",
    marginInline: "0.05rem",
    cursor: "pointer",
    fontFamily: "inherit",
    lineHeight: 1.4,
    verticalAlign: "baseline",
  },
  chipShort: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontWeight: 500,
    letterSpacing: "0.02em",
  },
  cards: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.45rem",
    columnGap: "0.45rem",
    marginBottom: "0.75rem",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.25rem",
    columnGap: "0.25rem",
    minWidth: "9rem",
    maxWidth: "16rem",
    borderRadius: "12px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(109, 40, 217, 0.22)",
    backgroundColor: "rgba(244, 235, 255, 0.55)",
    paddingBlock: "0.45rem",
    paddingInline: "0.6rem",
  },
  cardName: {
    fontSize: "0.88rem",
    fontWeight: 700,
    color: "#5b21b6",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  cardMeta: {
    fontSize: "0.72rem",
    color: "#7c3aed",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  cardActions: {
    display: "flex",
    rowGap: "0.35rem",
    columnGap: "0.35rem",
    marginTop: "0.15rem",
  },
});

const thread = stylex.create({
  item: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "22px",
    backgroundColor: "#fffdf8",
    padding: "1rem",
  },
  itemParagraph: {
    marginTop: 0,
    marginBottom: "0.9rem",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
    minWidth: {
      [mobile]: 0,
    },
  },
  itemSpeaking: {
    outlineWidth: "3px",
    outlineStyle: "solid",
    outlineColor: "#f5a623",
    boxShadow: "0 0 0 3px rgba(245, 166, 35, 0.16)",
  },
  itemPlayed: {
    backgroundColor: "#f6fef9",
    borderColor: "rgba(6, 118, 71, 0.24)",
  },
  itemMerged: {
    opacity: 0.25,
  },
  itemUser: {
    backgroundColor: "#f8fafc",
    borderColor: "rgba(21, 94, 239, 0.2)",
  },
  itemIdleNotification: {
    backgroundColor: "#f6fef9",
    borderColor: "rgba(6, 118, 71, 0.2)",
    borderRadius: "16px",
    paddingTop: "0.7rem",
    paddingRight: "0.85rem",
    paddingBottom: "0.7rem",
    paddingLeft: "0.85rem",
  },
  idleNotificationText: {
    alignItems: "center",
    color: "#067647",
    display: "inline-flex",
    fontSize: "0.92rem",
    fontWeight: 700,
    marginTop: 0,
    marginBottom: "0.25rem",
    overflowWrap: "anywhere",
  },
  idleNotificationMeta: {
    color: "#667085",
    fontSize: "0.78rem",
    marginTop: 0,
    marginBottom: "0.25rem",
  },
  itemAgent: {
    backgroundColor: "#fffdf8",
  },
  itemSystem: {
    backgroundColor: "#f6f7fb",
    borderColor: "rgba(71, 84, 103, 0.18)",
    paddingTop: "0.75rem",
    paddingBottom: "0.75rem",
  },
  systemNotice: {
    alignItems: "center",
    color: "#475467",
    display: "inline-flex",
    flexWrap: "wrap",
    fontSize: "0.9rem",
    fontWeight: 650,
    marginBottom: "0.35rem",
    rowGap: "0.35rem",
    columnGap: "0.45rem",
  },
  extraMarkdown: {
    backgroundColor: "#f8fafc",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "0.75rem",
    color: "#1f2937",
    marginTop: "-0.15rem",
    marginBottom: "0.9rem",
    paddingTop: "0.85rem",
    paddingRight: "2.6rem",
    paddingBottom: "0.85rem",
    paddingLeft: "0.85rem",
    position: "relative",
  },
  copyMarkdownButton: {
    appearance: "none",
    alignItems: "center",
    backgroundColor: {
      default: "transparent",
      ":hover": "rgba(23, 32, 42, 0.06)",
    },
    borderWidth: "0",
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: "999px",
    color: "#475467",
    cursor: "pointer",
    display: "inline-flex",
    font: "inherit",
    fontSize: "1rem",
    fontWeight: 700,
    height: "1.8rem",
    justifyContent: "center",
    opacity: {
      default: 0.72,
      ":hover": 1,
    },
    padding: 0,
    position: "absolute",
    right: "0.55rem",
    top: "0.55rem",
    width: "1.8rem",
    outlineWidth: {
      default: null,
      ":focus-visible": "2px",
    },
    outlineStyle: {
      default: null,
      ":focus-visible": "solid",
    },
    outlineColor: {
      default: null,
      ":focus-visible": "#1a56db",
    },
    outlineOffset: {
      default: null,
      ":focus-visible": "2px",
    },
  },
  copyMarkdownButtonCopied: {
    color: "#067647",
    opacity: 1,
  },
});

const messageMeta = stylex.create({
  root: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.85rem",
    marginBottom: "0.7rem",
    minWidth: 0,
    color: "#667085",
    alignItems: {
      default: "center",
      [mobile]: "flex-start",
    },
    flexWrap: {
      [mobile]: "wrap",
    },
    rowGap: {
      default: "0.75rem",
      [mobile]: "0.5rem",
    },
    columnGap: {
      default: "0.75rem",
      [mobile]: "0.5rem",
    },
  },
  idTime: {
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    minWidth: 0,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    minWidth: 0,
    maxWidth: "100%",
    marginTop: "0.2rem",
    alignItems: {
      default: "center",
      [mobile]: "stretch",
    },
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    flexDirection: {
      [mobile]: "column",
    },
    width: {
      [mobile]: "100%",
    },
  },
  links: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.2rem",
    columnGap: "0.2rem",
    marginTop: "0.3rem",
    marginBottom: "0.9rem",
  },
  link: {
    fontSize: "0.82em",
    color: "#1a56db",
    overflowWrap: "anywhere",
  },
  forwardNotice: {
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: "0.35rem",
    columnGap: "0.45rem",
    marginTop: "0.2rem",
    marginBottom: "0.75rem",
    color: "#667085",
    fontSize: "0.82rem",
  },
  attachments: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.6rem",
    columnGap: "0.6rem",
    marginTop: "0.35rem",
    marginBottom: "0.9rem",
  },
  attachmentLink: {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "flex-start",
    rowGap: "0.35rem",
    columnGap: "0.35rem",
    maxWidth: "100%",
    paddingTop: "0.5rem",
    paddingRight: "0.5rem",
    paddingBottom: "0.5rem",
    paddingLeft: "0.5rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "14px",
    backgroundColor: "#fff",
    textDecoration: "none",
    color: "#17202a",
  },
  attachmentImage: {
    display: "block",
    width: "72px",
    height: "72px",
    objectFit: "cover",
    borderRadius: "10px",
  },
  attachmentAudio: {
    width: "min(18rem, 100%)",
    maxWidth: "100%",
  },
  attachmentName: {
    fontSize: "0.78rem",
    color: "#52606d",
    maxWidth: "12rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sessionCards: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(auto-fit, minmax(16rem, 1fr))",
      [mobile]: "minmax(0, 1fr)",
    },
    rowGap: "0.6rem",
    columnGap: "0.6rem",
    marginTop: "0.35rem",
    marginBottom: "0.9rem",
  },
  sessionCard: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.45rem",
    minWidth: 0,
    padding: "0.75rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.14)",
    borderRadius: "14px",
    backgroundColor: "#fff",
  },
  sessionCardStatus: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    rowGap: "0.35rem",
    columnGap: "0.5rem",
  },
  sessionCardSummary: {
    marginTop: 0,
    marginBottom: 0,
    color: "#344054",
    fontSize: "0.88rem",
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  },
  sessionCardTitle: {
    fontWeight: 700,
    color: "#17202a",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sessionCardMeta: {
    color: "#667085",
    fontSize: "0.8rem",
    overflowWrap: "anywhere",
  },
  sessionCardDetails: {
    color: "#667085",
    fontSize: "0.78rem",
  },
  sessionCardDetailsSummary: {
    cursor: "pointer",
    fontWeight: 600,
  },
  sessionCardLastMessage: {
    marginTop: "0.35rem",
    color: "#344054",
    fontSize: "0.8rem",
    lineHeight: 1.4,
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  },
  sessionCardActions: {
    display: "flex",
    flexWrap: "nowrap",
    alignItems: "center",
    rowGap: "0.35rem",
    columnGap: "0.35rem",
  },
});

const delivery = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: "0.45rem",
    columnGap: "0.45rem",
    marginTop: "0.6rem",
  },
  details: {
    color: "#667085",
    fontSize: "0.78rem",
    lineHeight: 1.4,
    maxWidth: "100%",
  },
  summary: {
    cursor: "pointer",
    color: "#667085",
    fontWeight: 600,
    listStylePosition: "inside",
  },
  detailText: {
    marginTop: "0.25rem",
    marginBottom: 0,
    paddingLeft: "0.55rem",
    overflowWrap: "anywhere",
    color: "#475467",
  },
  detailError: {
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: "#fecdca",
  },
  detailWarning: {
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: "#fedf89",
  },
  messageError: {
    color: "#b42318",
    fontSize: "0.88rem",
  },
});

export function MessageRow({
  message,
  messages,
  onDelete,
  onInsertSessionMention,
  onPlay,
  onTogglePinned,
  onRetryPendingMessage,
  onRetryOpenCodeDelivery,
  onStop,
  speakingId,
}: {
  message: Message;
  messages: Message[];
  onDelete: (message: Message) => void;
  onInsertSessionMention?: (token: string) => void;
  onPlay: (message: Message) => void;
  onTogglePinned: (message: Message) => void;
  onRetryPendingMessage: (message: Message) => void;
  onRetryOpenCodeDelivery: (message: Message) => void;
  onStop: (message: Message) => void;
  speakingId: number | null;
}) {
  const isPlayed = playedStatuses.has(message.status);
  const isLocallySpeaking = message.id === speakingId;
  const isServerSpeaking = message.status === "speaking";
  const isAgent = message.author === "agent" && !message.pending;
  const isPendingFailed = message.pending && message.status === "failed";
  const isPinned = message.pinned === 1;
  const idleSessionId = idleNotificationSessionId(message);
  const idleSession = idleSessionId
    ? message.sessions?.find((session) => session.id === idleSessionId)
    : undefined;
  const isIdleNotification = idleSessionId != null;
  const isPlayable = isAgent || isIdleNotification;
  const paseoAgentNames = useMemo(() => buildPaseoAgentNameMap(messages), [messages]);
  const bodyParts = useMemo(
    () => splitTextWithPaseoMentions(message.text, paseoAgentNames),
    [message.text, paseoAgentNames],
  );
  const mentionCards = useMemo(
    () => uniquePaseoMentionsInText(message.text, paseoAgentNames),
    [message.text, paseoAgentNames],
  );
  const insertAgentMention = (agentId: string) => {
    const token = `@${agentId} `;
    if (onInsertSessionMention) {
      onInsertSessionMention(token);
      return;
    }
    window.dispatchEvent(new CustomEvent("say-to-me:append-to-composer", { detail: token }));
  };
  const idleSessionName = idleSession
    ? sessionListLabel({
        id: idleSession.id,
        alias: idleSession.alias,
        opencodeTitle: idleSession.title,
      })
    : idleSessionId;
  const idleForwardSourceIds =
    isIdleNotification && message.forwardRole === "target"
      ? messages
          .filter(
            (item) => item.forwardRole === "source" && item.forwardTargetMessageId === message.id,
          )
          .map((item) => item.id)
      : [];
  if (
    idleForwardSourceIds.length === 0 &&
    isIdleNotification &&
    message.forwardRole === "target" &&
    message.forwardSourceMessageId != null
  ) {
    idleForwardSourceIds.push(message.forwardSourceMessageId);
  }
  const [copiedMarkdown, setCopiedMarkdown] = React.useState(false);
  const forwardNotification = messages.find((item) => item.id === message.forwardTargetMessageId);
  const systemText = systemMessageText(message.text);

  async function copyExtraMarkdown() {
    if (!message.extraMarkdown) return;
    await navigator.clipboard.writeText(message.extraMarkdown);
    setCopiedMarkdown(true);
    setTimeout(() => setCopiedMarkdown(false), 1200);
  }

  return (
    <li
      {...stylex.props(
        thread.item,
        isPlayed && thread.itemPlayed,
        message.author === "agent" ? thread.itemAgent : thread.itemUser,
        isIdleNotification && thread.itemIdleNotification,
        !isIdleNotification && systemText != null && thread.itemSystem,
        message.mergedIntoMessageId != null && thread.itemMerged,
        isLocallySpeaking && thread.itemSpeaking,
      )}
      data-merged={message.mergedIntoMessageId != null ? "true" : undefined}
      id={`message-${message.id}`}
      data-thread-id={message.id}
    >
      <div {...stylex.props(messageMeta.root)}>
        <span {...stylex.props(messageMeta.idTime)}>
          <span>#{message.id}</span>
          <span>{formatMessageTime(message.createdAt)}</span>
        </span>
        <span {...stylex.props(queue.badges)}>
          <span {...stylex.props(badge.base, authorBadge[message.author])}>{message.author}</span>
          {message.paseoAuthor ? (
            <span {...stylex.props(badge.base, authorBadge.paseo)}>
              {message.paseoAuthorName || message.paseoAuthor}
            </span>
          ) : null}
          <span {...stylex.props(badge.base, badge[message.status as keyof typeof badge])}>
            {message.status}
          </span>
        </span>
      </div>
      {isIdleNotification ? (
        <>
          <p {...stylex.props(thread.idleNotificationText)}>{idleSessionName} is now idle</p>
          {idleForwardSourceIds.length > 0 ? (
            <p {...stylex.props(thread.idleNotificationMeta)}>
              Forwarded from {idleForwardSourceIds.map((id) => `#${id}`).join(", ")}
            </p>
          ) : null}
        </>
      ) : systemText ? (
        <div {...stylex.props(thread.systemNotice)}>
          <span {...stylex.props(badge.base, badge.done)}>System</span>
          <span>{systemText}</span>
        </div>
      ) : (
        <>
          <p {...stylex.props(thread.itemParagraph)}>
            {bodyParts.map((part, index) => {
              if (part.type === "text") {
                return <React.Fragment key={`t-${index}`}>{part.value}</React.Fragment>;
              }
              return (
                <button
                  key={`m-${part.id}-${index}`}
                  type="button"
                  title={`@${part.id} (Reply inserts full id)`}
                  {...stylex.props(mentionUi.chip, part.kind === "short" && mentionUi.chipShort)}
                  onClick={() => insertAgentMention(part.id)}
                >
                  @{part.label}
                </button>
              );
            })}
          </p>
          {mentionCards.length > 0 ? (
            <div {...stylex.props(mentionUi.cards)} data-paseo-mention-cards="true">
              {mentionCards.map((mention) => (
                <div key={mention.id} {...stylex.props(mentionUi.card)}>
                  <div {...stylex.props(mentionUi.cardName)} title={mention.id}>
                    {mention.label}
                  </div>
                  <div {...stylex.props(mentionUi.cardMeta)}>
                    {mention.kind === "name" ? shortPaseoAgentId(mention.id) : mention.id}
                  </div>
                  <div {...stylex.props(mentionUi.cardActions)}>
                    <button
                      type="button"
                      {...stylex.props(controls.button, controls.messageAction)}
                      onClick={() => insertAgentMention(mention.id)}
                    >
                      Reply
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
      {message.extraMarkdown ? (
        <div {...stylex.props(thread.extraMarkdown)}>
          <button
            {...stylex.props(
              thread.copyMarkdownButton,
              copiedMarkdown && thread.copyMarkdownButtonCopied,
            )}
            aria-label={copiedMarkdown ? "Copied markdown" : "Copy markdown"}
            title={copiedMarkdown ? "Copied" : "Copy markdown"}
            type="button"
            onClick={() => void copyExtraMarkdown()}
          >
            {copiedMarkdown ? "✓" : "⧉"}
          </button>
          {message.extraMarkdownHtml ? (
            <SafeHtml className="voice-note-markdown" html={message.extraMarkdownHtml} />
          ) : (
            // Degraded path for stale/cached payloads missing server HTML.
            <pre className="voice-note-markdown">{message.extraMarkdown}</pre>
          )}
        </div>
      ) : null}
      {message.attachments && message.attachments.length > 0 ? (
        <div {...stylex.props(messageMeta.attachments)}>
          {message.attachments.map((attachment, index) => {
            const imageSrc = attachment.thumbnailDataUrl || "";
            const audioSrc = attachment.mimeType.startsWith("audio/") ? attachment.url : "";
            const key = attachment.id || `${attachment.filePath}-${index}`;
            const tile = (
              <>
                {imageSrc ? (
                  <img
                    alt={attachment.originalName}
                    src={imageSrc}
                    {...stylex.props(messageMeta.attachmentImage)}
                  />
                ) : audioSrc ? (
                  <audio controls src={audioSrc} {...stylex.props(messageMeta.attachmentAudio)}>
                    <a href={audioSrc}>Download {attachment.originalName}</a>
                  </audio>
                ) : null}
                <span {...stylex.props(messageMeta.attachmentName)}>{attachment.originalName}</span>
              </>
            );
            if (audioSrc) {
              return (
                <div key={key} {...stylex.props(messageMeta.attachmentLink)}>
                  {tile}
                </div>
              );
            }
            return attachment.url ? (
              <a
                key={key}
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                {...stylex.props(messageMeta.attachmentLink)}
              >
                {tile}
              </a>
            ) : (
              <div key={key} {...stylex.props(messageMeta.attachmentLink)}>
                {tile}
              </div>
            );
          })}
        </div>
      ) : null}
      {message.links && message.links.length > 0 ? (
        <div {...stylex.props(messageMeta.links)}>
          {message.links.map((link) => (
            <a
              key={link}
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              {...stylex.props(messageMeta.link)}
            >
              {link}
            </a>
          ))}
        </div>
      ) : null}
      {!isIdleNotification && message.forwardRole ? (
        <div {...stylex.props(messageMeta.forwardNotice)}>
          <span {...stylex.props(badge.base, badge.pending)}>
            {message.forwardRole === "target" ? "Forwarded in" : "Forwarded out"}
          </span>
          <span>
            {message.forwardStatus === "notified" && forwardNotification ? (
              <a href={`#message-${forwardNotification.id}`} {...stylex.props(messageMeta.link)}>
                {forwardDetail(message, forwardNotification)}
              </a>
            ) : (
              forwardDetail(message, forwardNotification)
            )}
          </span>
        </div>
      ) : null}
      {!isIdleNotification && message.sessions && message.sessions.length > 0 ? (
        <div {...stylex.props(messageMeta.sessionCards)}>
          {message.sessions.map((session, index) => {
            const token = sessionMentionToken(session.id, session.alias);
            const headline = sessionListLabel({
              id: session.id,
              alias: session.alias,
              opencodeTitle: session.title,
            });
            const project = session.projectName ? `Project: ${session.projectName}` : null;
            const latest = session.latestActivity
              ? `Latest: ${formatMessageTime(session.latestActivity)}`
              : null;
            const summaryUpdated = session.summaryUpdatedAt
              ? `Updated: ${formatMessageTime(session.summaryUpdatedAt)}`
              : null;
            const isCurrentSession = session.id === message.sessionId;
            return (
              <div key={`${session.id}-${index}`} {...stylex.props(messageMeta.sessionCard)}>
                <div {...stylex.props(messageMeta.sessionCardTitle)}>{headline}</div>
                <div {...stylex.props(messageMeta.sessionCardStatus)}>
                  <span
                    {...stylex.props(
                      badge.base,
                      session.waitingState === "blocked" && badge.failed,
                      (session.waitingState === "needs_answer" ||
                        session.waitingState === "needs_direction" ||
                        session.waitingState === "working") &&
                        badge.pending,
                      session.waitingState === "can_continue" && badge.done,
                    )}
                  >
                    {cardStatusLabel(session.waitingState)}
                  </span>
                  {session.id.startsWith("vo_") || session.opencodeStatus ? (
                    <OpenCodeStatusBadge
                      status={
                        (session.opencodeStatus as typeof OpenCodeStatus.infer) ?? "unavailable"
                      }
                      backend={session.id.startsWith("vo_") ? "voice" : undefined}
                    />
                  ) : null}
                  {latest ? (
                    <span {...stylex.props(messageMeta.sessionCardMeta)}>{latest}</span>
                  ) : null}
                </div>
                <div {...stylex.props(messageMeta.sessionCardActions)}>
                  {isCurrentSession ? null : (
                    <Link
                      to={`/ses/${session.id}`}
                      {...stylex.props(controls.compactSecondaryLink)}
                    >
                      Open
                    </Link>
                  )}
                  <button
                    {...stylex.props(
                      controls.button,
                      controls.secondary,
                      controls.compact,
                      controls.autoMobileWidth,
                    )}
                    type="button"
                    onClick={() => {
                      if (onInsertSessionMention) {
                        onInsertSessionMention(token);
                        return;
                      }
                      window.dispatchEvent(
                        new CustomEvent("say-to-me:append-to-composer", { detail: `${token} ` }),
                      );
                    }}
                  >
                    Insert mention
                  </button>
                </div>
                {session.summary ? (
                  <p {...stylex.props(messageMeta.sessionCardSummary)}>{session.summary}</p>
                ) : null}
                {session.opencodeActivitySnippet ? (
                  <p {...stylex.props(messageMeta.sessionCardSummary)}>
                    Activity: {session.opencodeActivitySnippet}
                  </p>
                ) : null}
                <details {...stylex.props(messageMeta.sessionCardDetails)}>
                  <summary {...stylex.props(messageMeta.sessionCardDetailsSummary)}>
                    Details
                  </summary>
                  <div {...stylex.props(messageMeta.sessionCardMeta)}>{session.id}</div>
                  {summaryUpdated ? (
                    <div {...stylex.props(messageMeta.sessionCardMeta)}>{summaryUpdated}</div>
                  ) : null}
                  {session.latestMessageText ? (
                    <div {...stylex.props(messageMeta.sessionCardLastMessage)}>
                      Last {session.latestMessageAuthor ?? "message"}: {session.latestMessageText}
                    </div>
                  ) : null}
                  {project ? (
                    <div {...stylex.props(messageMeta.sessionCardMeta)}>{project}</div>
                  ) : null}
                  <div {...stylex.props(messageMeta.sessionCardMeta)}>
                    {[
                      session.state,
                      session.messageCount != null ? `${session.messageCount} messages` : null,
                    ]
                      .filter(Boolean)
                      .join(" | ")}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      ) : null}
      {message.opencodeDeliveryStatus ? (
        <DeliveryStatus message={message} onRetryOpenCodeDelivery={onRetryOpenCodeDelivery} />
      ) : null}
      {message.error ? <p {...stylex.props(delivery.messageError)}>{message.error}</p> : null}
      <div {...stylex.props(messageMeta.actions)}>
        {isPendingFailed ? (
          <button
            {...stylex.props(controls.button, controls.messageAction, controls.secondary)}
            type="button"
            onClick={() => onRetryPendingMessage(message)}
          >
            Retry
          </button>
        ) : null}
        {isPlayable ? (
          <>
            <button
              {...stylex.props(controls.button, controls.messageAction)}
              type="button"
              onClick={() => onPlay(message)}
            >
              {isLocallySpeaking ? "Restart" : "Play"}
            </button>
            <button
              {...stylex.props(controls.button, controls.messageAction)}
              type="button"
              onClick={() => onStop(message)}
              disabled={!isLocallySpeaking && !isServerSpeaking}
            >
              Stop
            </button>
          </>
        ) : null}
        {!message.pending && typeof message.id === "number" ? (
          <button
            {...stylex.props(controls.button, controls.messageAction, controls.secondary)}
            type="button"
            onClick={() => onTogglePinned(message)}
          >
            {isPinned ? "Unpin" : "Pin"}
          </button>
        ) : null}
        {message.paseoAuthor && message.paseoAuthor !== "manual" ? (
          <button
            {...stylex.props(controls.button, controls.messageAction)}
            type="button"
            onClick={() => insertAgentMention(message.paseoAuthor!)}
          >
            Reply
          </button>
        ) : null}
        <button
          {...stylex.props(controls.button, controls.messageAction, controls.danger)}
          type="button"
          onClick={() => onDelete(message)}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function DeliveryStatus({
  message,
  onRetryOpenCodeDelivery,
}: {
  message: Message;
  onRetryOpenCodeDelivery: (message: Message) => void;
}) {
  const status = deliveryStatusSet.has(message.opencodeDeliveryStatus || "")
    ? (message.opencodeDeliveryStatus as DeliveryStatusValue)
    : null;
  const provider = deliveryProviderLabel(message);
  const detailIsVisibleByDefault = status === "failed" || status === "cli_timed_out";
  const canRetryDelivery = provider === "OpenCode";

  return (
    <div {...stylex.props(delivery.row)}>
      <span {...stylex.props(badge.base, status && getDeliveryBadge(status))}>
        {deliveryStatusLabel(status, provider, message.opencodeDeliveryStatus)}
      </span>
      {message.opencodeDeliveryError ? (
        <details {...stylex.props(delivery.details)} open={detailIsVisibleByDefault}>
          <summary {...stylex.props(delivery.summary)}>Details</summary>
          <p {...stylex.props(delivery.detailText, getDeliveryDetailTone(status))}>
            {message.opencodeDeliveryError}
          </p>
        </details>
      ) : null}
      {canRetryDelivery && message.opencodeDeliveryStatus === "queued" ? (
        <button
          {...stylex.props(controls.button, controls.secondary)}
          type="button"
          onClick={() => onRetryOpenCodeDelivery(message)}
        >
          Force send
        </button>
      ) : null}
      {canRetryDelivery && message.opencodeDeliveryStatus === "failed" ? (
        <button
          {...stylex.props(controls.button, controls.secondary)}
          type="button"
          onClick={() => onRetryOpenCodeDelivery(message)}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
