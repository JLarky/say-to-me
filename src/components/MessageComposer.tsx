import { safeResponseJson } from "@say-to-me/runtime-validation";
import React, { useEffect, useRef, useState } from "react";
import * as stylex from "@stylexjs/stylex";

import {
  extractLeadingSessionMentions,
  extractLeadingSessionMessage,
} from "../session-mentions.ts";
import { sessionListLabel } from "../session-label.ts";
import { useElevatorMusic } from "../elevator-music.tsx";
import { card, misc } from "../styles/chrome.stylex.ts";
import { controls } from "../styles/controls.stylex.ts";
import type { Message, OpenCodeStatus, Session } from "../types.ts";
import { ImageUploadPayload, ErrorPayload } from "../types.ts";
import { composerSubmitIntent, createPendingMessage, type AgentReplyMode } from "../utils.ts";
import { openCodeSessionModelLabel, SessionModelControls } from "./SessionModelControls.tsx";

const forceSendLongPressMs = 650;

const composer = stylex.create({
  root: {
    marginTop: "1rem",
    padding: "1rem",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    flexWrap: "wrap",
    marginTop: "1rem",
  },
  options: {
    width: "100%",
    marginTop: "0.5rem",
  },
  optionsContent: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    marginTop: "0.75rem",
  },
  keepAwakeTracer: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.25rem",
  },
  keepAwakeTracerStatus: {
    color: "#667085",
    fontSize: "0.8rem",
    maxWidth: "24rem",
  },
  label: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    color: "#52606d",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    color: "#52606d",
  },
  imageChips: {
    display: "flex",
    flexWrap: "wrap",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    marginTop: "0.5rem",
  },
  imageChip: {
    display: "inline-flex",
    alignItems: "center",
    rowGap: "0.4rem",
    columnGap: "0.4rem",
    paddingTop: "0.25rem",
    paddingRight: "0.5rem",
    paddingBottom: "0.25rem",
    paddingLeft: "0.5rem",
    borderRadius: "0.5rem",
    backgroundColor: "#e4e7eb",
    color: "#3e4c59",
    fontSize: "0.85rem",
  },
  imageChipRemove: {
    borderWidth: 0,
    borderStyle: "none",
    borderColor: "transparent",
    backgroundColor: "transparent",
    cursor: "pointer",
    color: "#616e7c",
    fontSize: "1rem",
    lineHeight: 1,
    padding: 0,
  },
  sessionCards: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    marginTop: "0.5rem",
  },
  sessionCard: {
    display: "flex",
    flexDirection: "column",
    rowGap: "0.35rem",
    padding: "0.7rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.14)",
    borderRadius: "14px",
    backgroundColor: "#fff",
  },
  sessionCardTitle: {
    color: "#17202a",
    fontWeight: 700,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sessionCardMeta: {
    color: "#667085",
    fontSize: "0.82rem",
    overflowWrap: "anywhere",
  },
});

type UploadFileType = {
  extension: ".png" | ".jpg" | ".jpeg" | ".webp" | ".gif" | ".mp3";
  mimeType: string;
};

function uploadTypeForFile(file: File): UploadFileType {
  if (file.type === "image/png") return { extension: ".png", mimeType: "image/png" };
  if (file.type === "image/jpeg") {
    return {
      extension: file.name.toLowerCase().endsWith(".jpeg") ? ".jpeg" : ".jpg",
      mimeType: "image/jpeg",
    };
  }
  if (file.type === "image/webp") return { extension: ".webp", mimeType: "image/webp" };
  if (file.type === "image/gif") return { extension: ".gif", mimeType: "image/gif" };
  if (file.type === "audio/mpeg" || file.type === "audio/mp3") {
    return { extension: ".mp3", mimeType: "audio/mpeg" };
  }
  throw new Error(`Unsupported file type for ${file.name}. Please choose an image or MP3.`);
}

function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf("/") + 1);
}

export function MessageComposer({
  agentReplyMode = "speak",
  initialText = "",
  onSend,
  onSendDing = async () => false,
  onSoundEnabled = () => {},
  onWarmSendDing = async () => false,
  onSetAgentReplyMode = () => {},
  onSetUseCli,
  onStopSpeech,
  isSpeechActive = false,
  opencodeStatus,
  pendingId = () => `pending-${Date.now()}`,
  session,
  sessionId,
  useCli,
  appendTextRef,
}: {
  agentReplyMode?: AgentReplyMode;
  initialText?: string;
  opencodeStatus?: OpenCodeStatus | null;
  onSend: (message: Message) => Promise<void> | void;
  onSendDing?: (opts?: { volumeScale?: number }) => Promise<boolean>;
  onSoundEnabled?: () => void;
  onWarmSendDing?: () => Promise<boolean>;
  onSetAgentReplyMode?: (value: AgentReplyMode) => void;
  onSetUseCli?: (value: boolean) => void;
  onStopSpeech?: () => void;
  isSpeechActive?: boolean;
  pendingId?: () => string;
  session?: Session | null;
  sessionId: string | undefined;
  useCli?: boolean;
  appendTextRef?: React.MutableRefObject<((text: string) => void) | null>;
}) {
  const modelSummary = openCodeSessionModelLabel(session);
  const elevatorMusic = useElevatorMusic();
  const draftKey = sessionId ? `say-to-me-draft-${sessionId}` : null;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const requestedCaretPositionRef = useRef<number | null>(null);
  const prevSessionIdRef = useRef(sessionId);
  const [text, setText] = useState(() => {
    if (draftKey) {
      const saved = localStorage.getItem(draftKey);
      if (saved !== null) return saved;
    }
    return initialText;
  });

  useEffect(() => {
    if (!appendTextRef) return;
    appendTextRef.current = (canned: string) => {
      setText((prev) => {
        const next = prev.trim() === "" ? canned : `${prev}\n${canned}`;
        requestedCaretPositionRef.current = next.length;
        return next;
      });
    };
    return () => {
      appendTextRef.current = null;
    };
  }, [appendTextRef]);

  useEffect(() => {
    function handleAppend(event: Event) {
      const textToAppend = event instanceof CustomEvent ? event.detail : null;
      if (typeof textToAppend !== "string" || textToAppend.trim() === "") return;
      setText((prev) => {
        const next = prev.trim() === "" ? textToAppend : `${prev}\n${textToAppend}`;
        requestedCaretPositionRef.current = next.length;
        return next;
      });
    }

    window.addEventListener("say-to-me:append-to-composer", handleAppend);
    return () => window.removeEventListener("say-to-me:append-to-composer", handleAppend);
  }, []);
  const [author, setAuthor] = useState<"agent" | "user">("user");
  const [images, setImages] = useState<string[]>([]);
  const [notifyOnCompletion, setNotifyOnCompletion] = useState(true);
  const dingPlayedForSubmit = useRef(false);
  const keyboardForceRef = useRef(false);
  const longPressForceRef = useRef(false);
  const forceLongPressTimerRef = useRef<number | null>(null);
  const [keyboardForceHeld, setKeyboardForceHeld] = useState(false);
  const [longPressForceHeld, setLongPressForceHeld] = useState(false);
  const forceHeld = keyboardForceHeld || longPressForceHeld;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const leadingSessionMentions = extractLeadingSessionMentions(text);
  const relayPreview =
    author === "user" && images.length === 0 ? extractLeadingSessionMessage(text.trim()) : null;

  useEffect(() => {
    const requestedCaretPosition = requestedCaretPositionRef.current;
    if (requestedCaretPosition === null) return;
    requestedCaretPositionRef.current = null;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(requestedCaretPosition, requestedCaretPosition);
  }, [text]);

  useEffect(() => {
    const update = (event: KeyboardEvent) => {
      const held = event.metaKey || event.ctrlKey;
      keyboardForceRef.current = held;
      setKeyboardForceHeld(held);
    };
    const clear = () => {
      keyboardForceRef.current = false;
      setKeyboardForceHeld(false);
    };
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", clear);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (forceLongPressTimerRef.current !== null) {
        window.clearTimeout(forceLongPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const prevSessionId = prevSessionIdRef.current;
    prevSessionIdRef.current = sessionId;

    if (prevSessionId === sessionId || !sessionId) {
      if (!draftKey) return;
      if (text) {
        localStorage.setItem(draftKey, text);
      } else {
        localStorage.removeItem(draftKey);
      }
      return;
    }

    if (prevSessionId && text) {
      localStorage.setItem(`say-to-me-draft-${prevSessionId}`, text);
    }
    const saved = draftKey ? localStorage.getItem(draftKey) : null;
    setText(saved ?? initialText);
  }, [sessionId, text]);

  function clearForceLongPressTimer() {
    if (forceLongPressTimerRef.current === null) return;
    window.clearTimeout(forceLongPressTimerRef.current);
    forceLongPressTimerRef.current = null;
  }

  function handleSendPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    void onWarmSendDing();
    clearForceLongPressTimer();
    if (opencodeStatus !== "pending") return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    forceLongPressTimerRef.current = window.setTimeout(() => {
      forceLongPressTimerRef.current = null;
      longPressForceRef.current = true;
      setLongPressForceHeld(true);
    }, forceSendLongPressMs);
  }

  function clearForceLongPressState() {
    clearForceLongPressTimer();
    longPressForceRef.current = false;
    setLongPressForceHeld(false);
  }

  function clearForceLongPressHeld() {
    clearForceLongPressTimer();
    setLongPressForceHeld(false);
  }

  function handleSendPointerCancel() {
    clearForceLongPressState();
  }

  function handleSendPointerLeave() {
    if (longPressForceRef.current) {
      setLongPressForceHeld(false);
      return;
    }
    clearForceLongPressState();
  }

  function handleSendClick() {
    dingPlayedForSubmit.current = true;
    void onSendDing().then((played) => {
      if (played) onSoundEnabled();
    });
  }

  async function sendCurrentMessage(force: boolean) {
    const trimmed = text.trim();
    if (!dingPlayedForSubmit.current && (await onSendDing())) onSoundEnabled();
    dingPlayedForSubmit.current = false;
    if ((!trimmed && images.length === 0) || !sessionId) {
      clearForceLongPressState();
      return;
    }
    const relay =
      author === "user" && images.length === 0 ? extractLeadingSessionMessage(trimmed) : null;

    setUploadError("");
    setText("");
    setImages([]);
    if (draftKey) localStorage.removeItem(draftKey);
    await onSend(
      createPendingMessage({
        id: pendingId(),
        author,
        sessionId,
        text: relay?.text ?? trimmed,
        images: images.length > 0 ? images : undefined,
        useCli: author === "user" ? useCli : undefined,
        forceOpencode: author === "user" && force ? true : undefined,
        notifyOnCompletion: relay ? notifyOnCompletion : undefined,
        targetSessionId: relay?.session.id,
      }),
    );
    clearForceLongPressState();
  }

  async function submitMessage(event: React.FormEvent) {
    event.preventDefault();
    await sendCurrentMessage(keyboardForceRef.current || longPressForceRef.current);
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const intent = composerSubmitIntent(event);
    if (!intent) return;
    event.preventDefault();
    keyboardForceRef.current = intent === "force";
    event.currentTarget.form?.requestSubmit();
  }

  async function uploadAttachments(files: File[]) {
    if (files.length === 0) return;

    setUploadingImages(true);
    setUploadError("");

    try {
      const uploadedPaths: string[] = [];
      for (const file of files) {
        const { extension, mimeType } = uploadTypeForFile(file);

        const targetPath = `/tmp/${crypto.randomUUID()}${extension}`;
        const response = await fetch("/api/uploads/attachment", {
          method: "POST",
          headers: {
            "Content-Type": mimeType,
            "X-File-Name": file.name,
            "X-Target-Path": targetPath,
          },
          body: await file.arrayBuffer(),
        });

        if (!response.ok) {
          const payload = await safeResponseJson(response, ErrorPayload);
          throw new Error(payload.error || `Unable to upload ${file.name}.`);
        }

        const payload = await safeResponseJson(response, ImageUploadPayload);
        uploadedPaths.push(payload.attachment.filePath || targetPath);
      }

      setImages((current) => [...current, ...uploadedPaths.filter((p) => !current.includes(p))]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Unable to upload attachment.");
    } finally {
      setUploadingImages(false);
    }
  }

  async function handleImageSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    await uploadAttachments(files);
  }

  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = [...event.clipboardData.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (imageFiles.length === 0) return;
    event.preventDefault();
    void uploadAttachments(imageFiles);
  }

  return (
    <form {...stylex.props(card.base, composer.root)} onSubmit={submitMessage}>
      <textarea
        ref={textareaRef}
        {...stylex.props(controls.textarea)}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleComposerKeyDown}
        onPaste={handleComposerPaste}
        placeholder="Send a message to this session..."
        rows={4}
      />
      {images.length > 0 ? (
        <div {...stylex.props(composer.imageChips)}>
          {images.map((filePath) => (
            <span key={filePath} {...stylex.props(composer.imageChip)}>
              {basename(filePath)}
              <button
                {...stylex.props(composer.imageChipRemove)}
                type="button"
                aria-label={`Remove ${basename(filePath)}`}
                onClick={() => setImages((current) => current.filter((p) => p !== filePath))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {leadingSessionMentions.length > 0 ? (
        <div {...stylex.props(composer.sessionCards)} aria-label="Attached sessions">
          {leadingSessionMentions.map((ref) => (
            <div key={`${ref.id}-${ref.alias || ""}`} {...stylex.props(composer.sessionCard)}>
              <div {...stylex.props(composer.sessionCardTitle)}>
                {sessionListLabel({ id: ref.id, alias: ref.alias })}
              </div>
              <div {...stylex.props(composer.sessionCardMeta)}>{ref.id}</div>
            </div>
          ))}
        </div>
      ) : null}
      {relayPreview ? (
        <label {...stylex.props(composer.checkboxLabel)}>
          <input
            {...stylex.props(controls.checkboxInput)}
            aria-label="Notify when target session becomes idle"
            type="checkbox"
            checked={notifyOnCompletion}
            onChange={(event) => setNotifyOnCompletion(event.target.checked)}
          />
          Notify when target session becomes idle
        </label>
      ) : null}
      <div {...stylex.props(composer.actions)}>
        {onStopSpeech ? (
          <button
            {...stylex.props(controls.button, controls.danger, controls.autoMobileWidth)}
            type="button"
            onClick={onStopSpeech}
            disabled={!isSpeechActive}
          >
            Stop speech
          </button>
        ) : null}
        <button
          {...stylex.props(controls.button, controls.send)}
          type="submit"
          onClick={handleSendClick}
          onContextMenu={(event) => event.preventDefault()}
          onMouseUp={clearForceLongPressHeld}
          onPointerDown={handleSendPointerDown}
          onPointerCancel={handleSendPointerCancel}
          onPointerLeave={handleSendPointerLeave}
          onPointerUp={clearForceLongPressHeld}
          onTouchEnd={clearForceLongPressHeld}
        >
          {opencodeStatus === "pending" && !forceHeld ? "Queue" : "Send"}
        </button>
        <input
          ref={fileInputRef}
          accept="image/png,image/jpeg,image/webp,image/gif,audio/mpeg,.mp3"
          hidden
          multiple
          type="file"
          onChange={handleImageSelection}
        />
        <details {...stylex.props(composer.options)}>
          <summary>
            {"Options"}
            {(() => {
              const hints: string[] = [];
              if (modelSummary) hints.push(modelSummary);
              if (author === "agent") hints.push("agent");
              if (agentReplyMode === "manual") hints.push("manual replies");
              if (agentReplyMode === "shush") hints.push("shush");
              if (elevatorMusic.isPlaying) hints.push("music");
              if (useCli) hints.push("CLI updates");
              return hints.length > 0 ? ` (${hints.join(", ")})` : null;
            })()}
          </summary>
          <div {...stylex.props(composer.optionsContent)}>
            <button
              {...stylex.props(controls.button, controls.secondary, controls.autoMobileWidth)}
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImages}
            >
              {uploadingImages ? "Uploading attachments..." : "Add attachments"}
            </button>
            <div {...stylex.props(composer.keepAwakeTracer)}>
              <button
                {...stylex.props(controls.button, controls.secondary, controls.autoMobileWidth)}
                type="button"
                onClick={() => void elevatorMusic.toggle()}
              >
                {elevatorMusic.isPlaying ? "Pause elevator music" : "Play elevator music"}
              </button>
              <span {...stylex.props(composer.keepAwakeTracerStatus)}>
                {elevatorMusic.error
                  ? `Unable to play elevator music: ${elevatorMusic.error}`
                  : elevatorMusic.isPlaying
                    ? "Looping music is playing to help keep this browser tab awake while you wait for agent responses."
                    : "Play looping music to help keep this browser tab awake while you wait for agent responses."}
              </span>
            </div>
            <label {...stylex.props(composer.label)}>
              Type
              <select
                {...stylex.props(controls.select)}
                value={author}
                onChange={(event) => setAuthor(event.target.value as "agent" | "user")}
              >
                <option value="user">user reply</option>
                <option value="agent">agent voice message</option>
              </select>
            </label>
            <label {...stylex.props(composer.label)}>
              Agent replies
              <select
                {...stylex.props(controls.select)}
                value={agentReplyMode}
                onChange={(event) => onSetAgentReplyMode(event.target.value as AgentReplyMode)}
              >
                <option value="speak">Speak automatically</option>
                <option value="shush">Shush: mark played without speech</option>
                <option value="manual">Manual only</option>
              </select>
            </label>
            <SessionModelControls session={session || null} />
            <label {...stylex.props(composer.checkboxLabel)}>
              <input
                {...stylex.props(controls.checkboxInput)}
                type="checkbox"
                checked={useCli}
                onChange={(event) => onSetUseCli?.(event.target.checked)}
              />
              Use CLI for live updates (may add quotes to messages)
            </label>
          </div>
        </details>
      </div>
      {uploadError ? <div {...stylex.props(misc.error)}>{uploadError}</div> : null}
    </form>
  );
}
