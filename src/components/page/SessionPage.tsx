import { safeResponseJson } from "@say-to-me/runtime-validation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLoaderData, useParams } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { FloatingActionButton } from "../FloatingActionButton.tsx";
import { OrganizePathBreadcrumbs } from "../OrganizePathBreadcrumbs.tsx";
import { SessionTimerSummary } from "../JarvisTimers.tsx";
import { MessageComposer } from "../MessageComposer.tsx";
import { MessageList } from "../MessageList.tsx";
import { ClaudeActivity } from "../ClaudeActivity.tsx";
import { CodexActivity } from "../CodexActivity.tsx";
import { CursorActivity } from "../CursorActivity.tsx";
import { GrokActivity } from "../GrokActivity.tsx";
import { PaseoActivity } from "../PaseoActivity.tsx";
import { OpenCodeActivityPreview } from "../OpenCodeActivityPreview.tsx";
import { PageShell } from "../PageShell.tsx";
import { SessionStatusControls } from "../SessionStatusControls.tsx";
import { WaitingStateChip } from "../WaitingStateChip.tsx";
import { browserPlaybackStore, useBrowserPlaybackSnapshot } from "../../browser-playback-store.ts";
import { useSoundContext } from "../../layouts/RootLayout.tsx";
import { sessionLoader } from "../../loaders.ts";
import {
  resolveListDisplayName,
  resolveProviderTitleLabel,
  resolveSessionPageIdentityLabel,
} from "../../session-display.ts";
import { sessionMentionToken } from "../../session-mentions.ts";
import { ORGANIZE_ROOT_CRUMB } from "../../session-organize-path.ts";
import { playIdleCompletionDing, playSendDing, warmSendDing } from "../../sound.ts";
import { card, misc } from "../../styles/chrome.stylex.ts";
import { controls } from "../../styles/controls.stylex.ts";
import { badge, queue } from "../../styles/feed.stylex.ts";
import { session as sessionStyles } from "../../styles/session.stylex.ts";
import { tracedSend } from "../../tracing.ts";
import {
  Capabilities as CapabilitiesSchema,
  ErrorPayload,
  MessagesPayload,
  MessageResponsePayload,
  OpenCodeActivitySchema,
  SessionPayload,
  type Capabilities,
  type Message,
  type OpenCodeActivity,
  type OpenCodeStatus,
} from "../../types.ts";
import { useSessionSync } from "../../use-session-sync.ts";
import {
  type AgentReplyMode,
  buildMessages,
  failPendingMessage,
  playedStatuses,
  projectIdentity,
  recentMessageLinks,
  recentMessageSessions,
  replacePendingMessage,
  upsertPendingMessage,
} from "../../utils.ts";

import {
  browserSpeechText,
  buildPaseoAgentNameMap,
  delay,
  idleNotificationSpeakingMs,
  isIdleNotificationMessage,
  paseoChatListenerStatus,
  preferredBrowserSpeechVoice,
  sessionMessageRequestBody,
  shortSessionId,
  shouldAutoplayMessage,
  shouldShushPlayback,
} from "../../session-page-helpers.ts";

export {
  idleNotificationSpeechText,
  isIdleNotificationMessage,
  preferredBrowserSpeechVoice,
  sessionIdWithDisplayName,
  sessionMessageRequestBody,
  shouldAutoplayMessage,
  shouldShushPlayback,
} from "../../session-page-helpers.ts";

export function SessionPage() {
  const { sessionId } = useParams();
  const {
    initialSession,
    initialMessages,
    initialSessions,
    lastNoteFirstLine: initialNoteFirstLine,
    initialExternalCliActivity,
  } = useLoaderData<typeof sessionLoader>();

  const appendToComposerRef = useRef<((text: string) => void) | null>(null);

  function handleCannedMessage(text: string) {
    appendToComposerRef.current?.(text);
  }

  const [capabilities, setCapabilities] = useState<Capabilities & { loaded: boolean }>({
    loaded: false,
    opencodeLocalBase: null,
    opencodeTailscaleBase: null,
    opencodeDirB64: null,
    openCodeActivityPreview: false,
  });
  const [agentReplyMode, setAgentReplyMode] = useState<AgentReplyMode>(() => {
    const saved = localStorage.getItem("say-to-me-agent-replies");
    if (saved === "speak" || saved === "shush" || saved === "manual") return saved;
    if (localStorage.getItem("say-to-me-shush") === "true") return "shush";
    if (localStorage.getItem("say-to-me-autoplay") === "false") return "manual";
    return "speak";
  });
  const [useCli, setUseCli] = useState(
    () => localStorage.getItem("say-to-me-opencode-cli") === "true",
  );
  const {
    setSoundEnabled,
    showEnableSound,
    setShowEnableSound,
    showEnableNotif,
    setShowEnableNotif,
    enableSound,
    enableNotifications,
  } = useSoundContext();
  const browserPlayback = useBrowserPlaybackSnapshot();
  const speakingId = browserPlayback.messageId;
  const [error, setError] = useState("");
  const {
    applyPayload,
    externalCliActivity,
    lastNoteFirstLine,
    liveStatus,
    messages,
    session,
    setMessages,
    setSession,
    setSessions,
  } = useSessionSync({
    initialExternalCliActivity,
    initialLastNoteFirstLine: initialNoteFirstLine,
    initialMessages,
    initialSession,
    initialSessions,
    onError: setError,
    sessionId,
  });
  const paseoAgentNames = useMemo(() => buildPaseoAgentNameMap(messages), [messages]);
  const [showTitleEditButton, setShowTitleEditButton] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialSession?.opencodeTitle || "");
  const [savingTitle, setSavingTitle] = useState(false);
  const [showAliasEditButton, setShowAliasEditButton] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasDraft, setAliasDraft] = useState(initialSession?.alias || "");
  const [savingAlias, setSavingAlias] = useState(false);
  const [mentionCopied, setMentionCopied] = useState(false);
  const [queuedIdleNotificationIds, setQueuedIdleNotificationIds] = useState<Set<Message["id"]>>(
    () => new Set(),
  );
  const pendingCounter = useRef(0);
  const knownIdleNotificationIdsRef = useRef<Set<Message["id"]> | null>(null);
  const staleSpeakingCleanupRanRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("say-to-me-agent-replies", agentReplyMode);
    localStorage.setItem("say-to-me-autoplay", String(agentReplyMode !== "manual"));
    localStorage.setItem("say-to-me-shush", String(agentReplyMode === "shush"));
  }, [agentReplyMode]);

  useEffect(() => {
    localStorage.setItem("say-to-me-opencode-cli", String(useCli));
  }, [useCli]);

  useEffect(() => {
    if (!editingTitle) setTitleDraft(session?.opencodeTitle || "");
  }, [editingTitle, session?.opencodeTitle]);

  useEffect(() => {
    if (!editingAlias) setAliasDraft(session?.alias || "");
  }, [editingAlias, session?.alias]);

  useEffect(() => {
    if (!sessionId || sessionId === "default") {
      document.title = "Say To Me";
    } else {
      const label = session
        ? resolveListDisplayName({
            id: session.id,
            alias: session.alias,
            opencodeTitle: session.opencodeTitle,
            cwd: session.cwd,
          })
        : sessionId;
      document.title = `${label} — Say To Me`;
    }
  }, [sessionId, session?.alias, session?.opencodeTitle, session?.cwd, session?.id]);

  useEffect(() => {
    // Loader already provided initialSessions; skip a duplicate /api/sessions round-trip
    // on first paint. Capabilities are small and cheap — still warm them once.
    if (initialSessions.length === 0) void refreshSessions();
    void refreshCapabilities();
  }, []);

  const orderedMessages = useMemo(() => buildMessages(messages), [messages]);
  const nextQueued = useMemo(
    () => messages.find((message) => shouldAutoplayMessage(message, queuedIdleNotificationIds)),
    [messages, queuedIdleNotificationIds],
  );
  const waitingCount = useMemo(
    () =>
      messages.filter(
        (message) => message.author === "agent" && !playedStatuses.has(message.status),
      ).length,
    [messages],
  );
  const playedCount = useMemo(
    () =>
      messages.filter((message) => message.author === "agent" && playedStatuses.has(message.status))
        .length,
    [messages],
  );
  const activeMessage = useMemo(
    () => messages.find((message) => message.id === speakingId || message.status === "speaking"),
    [messages, speakingId],
  );
  const recentLinks = useMemo(() => recentMessageLinks(messages), [messages]);
  const recentSessions = useMemo(
    () => recentMessageSessions(messages, 3, sessionId),
    [messages, sessionId],
  );
  // Changes whenever the newest message or its delivery status changes, so the
  // waiting-state chip refetches as soon as the SSE stream lands an update.
  const waitingStateRefreshKey = useMemo(() => {
    const latest = messages.at(-1);
    return `${session?.revision ?? 0}:${latest ? `${latest.id}:${latest.status}:${latest.opencodeDeliveryStatus ?? ""}` : ""}`;
  }, [messages, session?.revision]);
  const identity = projectIdentity(
    session || {
      id: sessionId || "default",
      opencodeTitle: sessionId === "default" ? "default" : null,
    },
  );

  useEffect(() => {
    const autoplay = agentReplyMode !== "manual";
    if (!autoplay || speakingId || !nextQueued) return;
    void playMessage(nextQueued, { respectShush: true });
  }, [agentReplyMode, speakingId, nextQueued]);

  useEffect(() => {
    if (staleSpeakingCleanupRanRef.current) return;
    if (speakingId) return;
    staleSpeakingCleanupRanRef.current = true;
    for (const message of messages) {
      if (message.status === "speaking") void updateStatus(message.id as number, "stopped");
    }
  }, [messages, speakingId]);

  useEffect(() => {
    const idleNotifications = messages.filter(isIdleNotificationMessage);
    const known = knownIdleNotificationIdsRef.current;
    if (!known) {
      knownIdleNotificationIdsRef.current = new Set(idleNotifications.map((message) => message.id));
      return;
    }

    const fresh = idleNotifications.filter((message) => !known.has(message.id));
    for (const message of fresh) known.add(message.id);
    if (fresh.length > 0) {
      setQueuedIdleNotificationIds((current) => {
        const next = new Set(current);
        for (const message of fresh) next.add(message.id);
        return next;
      });
    }
  }, [messages]);

  async function refreshSessions() {
    const response = await fetch("/api/sessions");
    const payload = await safeResponseJson(response, MessagesPayload);
    setSessions(payload.sessions || []);
  }

  function applyCapabilities(nextCapabilities: Capabilities) {
    setCapabilities({ ...nextCapabilities, loaded: true });
  }

  async function refreshCapabilities() {
    const response = await fetch("/api/capabilities");
    applyCapabilities(await safeResponseJson(response, CapabilitiesSchema));
  }

  async function refreshSessionPage(): Promise<OpenCodeActivity | null> {
    if (!sessionId) return null;
    try {
      const [sessionResponse, capabilitiesResponse] = await Promise.all([
        fetch(`/api/sessions/${sessionId}/messages`),
        fetch("/api/capabilities"),
      ]);
      if (!sessionResponse.ok) throw new Error(`Session refresh failed: ${sessionResponse.status}`);
      if (!capabilitiesResponse.ok) {
        throw new Error(`Capabilities refresh failed: ${capabilitiesResponse.status}`);
      }

      applyPayload(await safeResponseJson(sessionResponse, MessagesPayload));
      const nextCapabilities = await safeResponseJson(capabilitiesResponse, CapabilitiesSchema);
      applyCapabilities(nextCapabilities);

      if (
        !nextCapabilities.openCodeActivityPreview ||
        sessionId === "default" ||
        !sessionId.startsWith("ses_")
      ) {
        setError("");
        return null;
      }

      const activityResponse = await fetch(`/api/sessions/${sessionId}/opencode-activity`);
      if (!activityResponse.ok) {
        throw new Error(`Activity refresh failed: ${activityResponse.status}`);
      }
      setError("");
      return await safeResponseJson(activityResponse, OpenCodeActivitySchema);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to refresh session page.");
      return null;
    }
  }

  function applyActivityStatus(status: OpenCodeStatus) {
    setSession((current) => (current ? { ...current, opencodeStatus: status } : current));
  }

  async function sendOptimisticMessage(pendingMessage: Message) {
    return tracedSend(
      "sendOptimisticMessage",
      {
        "message.session_id": pendingMessage.sessionId,
        "message.author": pendingMessage.author,
        "message.text_length": pendingMessage.text.length,
        "message.text_preview": pendingMessage.text.slice(0, 120),
        "message.pending_id": String(pendingMessage.id),
      },
      async () => {
        setMessages((current) => upsertPendingMessage(current, pendingMessage));

        const response = await fetch(`/api/sessions/${pendingMessage.sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sessionMessageRequestBody(pendingMessage)),
        });

        if (!response.ok) {
          const payload = await safeResponseJson(response, ErrorPayload);
          const nextError = payload.error || "Unable to submit message.";
          setError(nextError);
          setMessages((current) => failPendingMessage(current, pendingMessage.id, nextError));
          return;
        }

        const payload = await safeResponseJson(response, MessageResponsePayload);
        setMessages((current) =>
          replacePendingMessage(current, pendingMessage.id, payload.message),
        );
      },
    );
  }

  async function retryPendingMessage(message: Message) {
    setError("");
    await sendOptimisticMessage({ ...message, status: "pending", error: null });
  }

  async function requestOpenCodeCompact() {
    if (!sessionId) return;
    setError("");
    const response = await fetch(`/api/sessions/${sessionId}/compact-opencode`, {
      method: "POST",
    });
    if (!response.ok) {
      const payload = await safeResponseJson(response, ErrorPayload);
      setError(payload.error || "Unable to compact OpenCode session.");
      return;
    }
    await refreshSessionPage();
  }

  async function updateStatus(id: number, status: string) {
    await fetch(`/api/messages/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function togglePinned(message: Message) {
    if (message.pending || typeof message.id !== "number") return;
    const pinned = message.pinned !== 1;
    const response = await fetch(`/api/messages/${message.id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    if (!response.ok) {
      const payload = await safeResponseJson(response, ErrorPayload);
      setError(payload.error || "Unable to update message pin.");
      return;
    }
    setError("");
    setMessages((current) =>
      current.map((item) => (item.id === message.id ? { ...item, pinned: pinned ? 1 : 0 } : item)),
    );
  }

  async function playMessage(message: Message, { respectShush = false } = {}) {
    if (message.author !== "agent" && !isIdleNotificationMessage(message)) return;
    if (browserPlaybackStore.getSnapshot().messageId) await stopPlayback();
    setError("");
    const playbackToken = browserPlaybackStore.begin({
      messageId: message.id as number,
      sessionId: message.sessionId,
    });

    // Mark all older unplayed agent messages in this session as played.
    const skipped = messages.filter(
      (m) =>
        m.author === "agent" &&
        m.id < message.id &&
        !playedStatuses.has(m.status) &&
        m.status !== "stopped",
    );
    await Promise.all(skipped.map((m) => updateStatus(m.id as number, "played")));

    if (shouldShushPlayback(agentReplyMode, { respectShush })) {
      await updateStatus(message.id as number, "played");
      browserPlaybackStore.finish(playbackToken);
      return;
    }

    await playInBrowser(message, playbackToken);
  }

  async function playInBrowser(message: Message, playbackToken: number) {
    if (isIdleNotificationMessage(message)) {
      await playIdleNotificationInBrowser(message, playbackToken);
      return;
    }

    if (!("speechSynthesis" in window)) {
      browserPlaybackStore.finish(playbackToken);
      setError("This browser does not support speechSynthesis.");
      return;
    }

    window.speechSynthesis.cancel();
    await updateStatus(message.id as number, "speaking");
    // Keep stored text (and reply @uuid tokens) intact; only rewrite speech.
    const utterance = new SpeechSynthesisUtterance(browserSpeechText(message, paseoAgentNames));
    const voice = preferredBrowserSpeechVoice(window.speechSynthesis.getVoices());
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang || "en-US";
    }
    browserPlaybackStore.setCancel(playbackToken, () => {
      utterance.onend = null;
      utterance.onerror = null;
      utterance.onstart = null;
      window.speechSynthesis.cancel();
    });

    utterance.onstart = () => {
      if (!browserPlaybackStore.isActive(playbackToken, message.id as number)) return;
      browserPlaybackStore.setSoundEnabled(true);
    };

    utterance.onend = async () => {
      if (!browserPlaybackStore.isActive(playbackToken, message.id as number)) return;
      await updateStatus(message.id as number, "played");
      browserPlaybackStore.finish(playbackToken);
    };

    utterance.onerror = async () => {
      if (!browserPlaybackStore.isActive(playbackToken, message.id as number)) return;
      await updateStatus(message.id as number, "stopped");
      browserPlaybackStore.finish(playbackToken);
      setError("Browser speech failed or was interrupted.");
    };

    window.speechSynthesis.speak(utterance);
  }

  async function playIdleNotificationInBrowser(message: Message, playbackToken: number) {
    await updateStatus(message.id as number, "speaking");
    const played = await playIdleCompletionDing({ volumeScale: 0.9 });
    await delay(idleNotificationSpeakingMs);
    if (!browserPlaybackStore.isActive(playbackToken, message.id as number)) return;
    await updateStatus(message.id as number, played ? "played" : "stopped");
    browserPlaybackStore.finish(playbackToken);
    if (!played) setError("Browser audio failed or was blocked.");
  }

  async function markSessionMessagesPlayed() {
    const unplayed = messages.filter(
      (message) =>
        typeof message.id === "number" &&
        (message.author === "agent" || isIdleNotificationMessage(message)) &&
        !playedStatuses.has(message.status),
    );

    if (unplayed.length === 0) return;
    setMessages((current) =>
      current.map((message) =>
        unplayed.some((played) => played.id === message.id)
          ? { ...message, status: "played" }
          : message,
      ),
    );
    await Promise.all(unplayed.map((message) => updateStatus(message.id as number, "played")));
  }

  async function stopPlayback(
    message = activeMessage,
    { markAllPlayed = false }: { markAllPlayed?: boolean } = {},
  ) {
    const active = await browserPlaybackStore.stopAll();
    if (markAllPlayed) {
      await markSessionMessagesPlayed();
      return;
    }
    const id = active?.messageId || message?.id;
    if (id) await updateStatus(id as number, "stopped");
  }

  async function deleteMessage(message: Message) {
    if (message.pending) {
      setMessages((current) => current.filter((item) => item.id !== message.id));
      return;
    }
    if (message.id === browserPlaybackStore.getSnapshot().messageId) await stopPlayback();
    await fetch(`/api/messages/${message.id}`, { method: "DELETE" });
    setMessages((current) => current.filter((item) => item.id !== message.id));
  }

  async function retryOpenCodeDelivery(message: Message) {
    const response = await fetch(`/api/messages/${message.id}/retry-opencode`, { method: "POST" });

    if (!response.ok) {
      const payload = await safeResponseJson(response, ErrorPayload);
      setError(payload.error || "Unable to retry OpenCode delivery.");
      return;
    }

    setError("");
  }

  async function stopOpenCode() {
    if (!sessionId) return;
    const response = await fetch(`/api/sessions/${sessionId}/stop-opencode`, { method: "POST" });

    if (!response.ok) {
      const payload = await safeResponseJson(response, ErrorPayload);
      setError(payload.error || "Unable to stop OpenCode session.");
      return;
    }

    const payload = await safeResponseJson(response, MessagesPayload);
    setMessages(payload.messages || []);
    setSession(payload.session || null);
    setSessions(payload.sessions || []);
    setError("");
  }

  async function stopCursor() {
    if (!sessionId) return;
    const response = await fetch(`/api/sessions/${sessionId}/stop-cursor`, { method: "POST" });

    if (!response.ok) {
      const payload = await safeResponseJson(response, ErrorPayload);
      setError(payload.error || "Unable to stop Cursor session.");
      return;
    }

    const payload = await safeResponseJson(response, MessagesPayload);
    setMessages(payload.messages || []);
    setSession(payload.session || null);
    setSessions(payload.sessions || []);
    setError("");
  }

  async function stopClaude() {
    if (!sessionId) return;
    const response = await fetch(`/api/sessions/${sessionId}/stop-claude`, { method: "POST" });

    if (!response.ok) {
      const payload = await safeResponseJson(response, ErrorPayload);
      setError(payload.error || "Unable to stop Claude session.");
      return;
    }

    const payload = await safeResponseJson(response, MessagesPayload);
    setMessages(payload.messages || []);
    setSession(payload.session || null);
    setSessions(payload.sessions || []);
    setError("");
  }

  async function stopCodex() {
    if (!sessionId) return;
    const response = await fetch(`/api/sessions/${sessionId}/stop-codex`, { method: "POST" });

    if (!response.ok) {
      const payload = await safeResponseJson(response, ErrorPayload);
      setError(payload.error || "Unable to stop Codex session.");
      return;
    }

    const payload = await safeResponseJson(response, MessagesPayload);
    setMessages(payload.messages || []);
    setSession(payload.session || null);
    setSessions(payload.sessions || []);
    setError("");
  }

  async function stopGrok() {
    if (!sessionId) return;
    const response = await fetch(`/api/sessions/${sessionId}/stop-grok`, { method: "POST" });

    if (!response.ok) {
      const payload = await safeResponseJson(response, ErrorPayload);
      setError(payload.error || "Unable to stop Grok session.");
      return;
    }

    const payload = await safeResponseJson(response, MessagesPayload);
    setMessages(payload.messages || []);
    setSession(payload.session || null);
    setSessions(payload.sessions || []);
    setError("");
  }

  async function stopPaseo() {
    if (!sessionId) return;
    const response = await fetch(`/api/sessions/${sessionId}/stop-paseo`, { method: "POST" });

    if (!response.ok) {
      const payload = await safeResponseJson(response, ErrorPayload);
      setError(payload.error || "Unable to stop Paseo session.");
      return;
    }

    const payload = await safeResponseJson(response, MessagesPayload);
    setMessages(payload.messages || []);
    setSession(payload.session || null);
    setSessions(payload.sessions || []);
    setError("");
  }

  async function saveSessionAlias(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId || sessionId === "default") return;

    setSavingAlias(true);
    try {
      const alias = aliasDraft.trim();
      const response = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: alias || null }),
      });
      const payload = await safeResponseJson(response, ErrorPayload);
      if (!response.ok) {
        setError(payload.error || "Could not rename the session alias.");
        return;
      }
      const parsed = SessionPayload.assert(payload);
      setSession(parsed.session);
      setSessions((current) =>
        current.some((item) => item.id === parsed.session.id)
          ? current.map((item) => (item.id === parsed.session.id ? parsed.session : item))
          : current,
      );
      setEditingAlias(false);
      setShowAliasEditButton(false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename the session alias.");
    } finally {
      setSavingAlias(false);
    }
  }

  async function saveOpenCodeTitle(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId || !/^ses_[A-Za-z0-9]+$/.test(sessionId)) return;
    const title = titleDraft.trim();
    if (!title) {
      setError("Title is required.");
      return;
    }

    setSavingTitle(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/opencode-title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const payload = await safeResponseJson(response, ErrorPayload);
      if (!response.ok) {
        setError(payload.error || "Unable to update OpenCode session title.");
        return;
      }
      const parsed = SessionPayload.assert(payload);
      setSession(parsed.session);
      setEditingTitle(false);
      setShowTitleEditButton(false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update OpenCode session title.");
    } finally {
      setSavingTitle(false);
    }
  }

  const displayInput = useMemo(
    () =>
      session && sessionId
        ? {
            id: session.id,
            alias: session.alias,
            opencodeTitle: session.opencodeTitle,
            cwd: session.cwd,
          }
        : sessionId
          ? { id: sessionId, alias: null, opencodeTitle: null, cwd: null }
          : null,
    [session, sessionId],
  );
  const identityLabel = displayInput ? resolveSessionPageIdentityLabel(displayInput) : "";
  const providerTitleLabel = displayInput ? resolveProviderTitleLabel(displayInput) : "";
  const sessionIdShortLabel = sessionId ? shortSessionId(sessionId) : "";
  const canEditTitle = Boolean(sessionId && /^ses_[A-Za-z0-9]+$/.test(sessionId));
  const showSessionIdentity = Boolean(sessionId && sessionId !== "default");
  const canRenameSession = showSessionIdentity;
  const paseoChatStatus = paseoChatListenerStatus(session);

  async function copySessionMention() {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionMentionToken(sessionId, session?.alias ?? null));
      setMentionCopied(true);
      window.setTimeout(() => setMentionCopied(false), 1500);
    } catch {
      setError("Could not copy the session mention.");
    }
  }

  return (
    <PageShell
      identity={identity}
      currentSessionId={sessionId}
      backTo="/"
      backLabel="Back to sessions"
      eyebrowLead={
        session?.organizePath?.length ? (
          <OrganizePathBreadcrumbs path={session.organizePath} />
        ) : session ? (
          <OrganizePathBreadcrumbs path={[ORGANIZE_ROOT_CRUMB]} />
        ) : null
      }
      eyebrowExtras={
        <>
          <SessionStatusControls
            session={session}
            sessionId={sessionId}
            onStopOpenCode={stopOpenCode}
            onStopCursor={stopCursor}
            onStopClaude={stopClaude}
            onStopCodex={stopCodex}
            onStopGrok={stopGrok}
            onStopPaseo={stopPaseo}
            capabilities={capabilities}
            externalCliActivity={externalCliActivity}
            onCannedMessage={handleCannedMessage}
            recentLinks={recentLinks}
            recentSessions={recentSessions}
          />
          <span
            {...stylex.props(
              badge.base,
              liveStatus === "connected" && badge.done,
              liveStatus === "quiet" && badge.pending,
              liveStatus === "reconnecting" && badge.failed,
            )}
            title="Main session message stream status"
          >
            Live updates: {liveStatus}
          </span>
          {paseoChatStatus ? (
            <span
              {...stylex.props(
                badge.base,
                paseoChatStatus.active ? badge.listening : badge.stopped,
              )}
              role="status"
              title="Archive this session to pause Paseo chat listening; restore it to resume."
            >
              {paseoChatStatus.label}
            </span>
          ) : null}
        </>
      }
      hero={
        <>
          <div {...stylex.props(sessionStyles.titleCluster)}>
            {editingAlias ? (
              <form
                {...stylex.props(sessionStyles.titleEditForm, sessionStyles.heroTitleRow)}
                onSubmit={saveSessionAlias}
              >
                <input
                  {...stylex.props(sessionStyles.titleEditInput)}
                  aria-label="Session alias"
                  autoFocus
                  value={aliasDraft}
                  onChange={(event) => setAliasDraft(event.target.value)}
                  placeholder={identityLabel}
                />
                <button
                  {...stylex.props(controls.button, controls.secondary)}
                  disabled={savingAlias}
                >
                  {savingAlias ? "Saving..." : "Save alias"}
                </button>
                <button
                  {...stylex.props(controls.button, controls.secondary)}
                  type="button"
                  onClick={() => {
                    setEditingAlias(false);
                    setShowAliasEditButton(false);
                    setAliasDraft(session?.alias || "");
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : identityLabel ? (
              <div {...stylex.props(sessionStyles.heroTitleRow)}>
                <h1 {...stylex.props(sessionStyles.heroTitle, sessionStyles.title)}>
                  <span
                    {...stylex.props(
                      sessionStyles.identityPrimary,
                      canRenameSession && sessionStyles.titleClickable,
                    )}
                    onClick={() => canRenameSession && setShowAliasEditButton(true)}
                  >
                    {identityLabel}
                  </span>
                </h1>
                {canRenameSession && showAliasEditButton ? (
                  <button
                    {...stylex.props(sessionStyles.titleEditButton)}
                    type="button"
                    aria-label="Edit session alias"
                    title="Edit session alias"
                    onClick={() => {
                      setAliasDraft(session?.alias || "");
                      setEditingAlias(true);
                    }}
                  >
                    ✎
                  </button>
                ) : null}
              </div>
            ) : null}
            {editingTitle ? (
              <form
                {...stylex.props(sessionStyles.titleEditForm, sessionStyles.providerTitleRow)}
                onSubmit={saveOpenCodeTitle}
              >
                <input
                  {...stylex.props(sessionStyles.titleEditInput)}
                  aria-label="OpenCode session title"
                  autoFocus
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                />
                <button
                  {...stylex.props(controls.button, controls.secondary)}
                  disabled={savingTitle}
                >
                  {savingTitle ? "Saving..." : "Save title"}
                </button>
                <button
                  {...stylex.props(controls.button, controls.secondary)}
                  type="button"
                  onClick={() => {
                    setEditingTitle(false);
                    setShowTitleEditButton(false);
                    setTitleDraft(session?.opencodeTitle || "");
                  }}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div
                {...stylex.props(sessionStyles.editableTitleRow, sessionStyles.providerTitleRow)}
              >
                {providerTitleLabel ? (
                  <span
                    {...stylex.props(
                      sessionStyles.providerTitleText,
                      canEditTitle && sessionStyles.titleClickable,
                    )}
                    onClick={() => canEditTitle && setShowTitleEditButton(true)}
                  >
                    {providerTitleLabel}
                  </span>
                ) : null}
                {showSessionIdentity ? (
                  <button
                    {...stylex.props(sessionStyles.copyMentionButton)}
                    type="button"
                    aria-label="Copy session mention"
                    title={`Copy say-to-me(...) mention for ${sessionId}`}
                    onClick={() => void copySessionMention()}
                  >
                    {mentionCopied ? "Copied" : sessionIdShortLabel}
                  </button>
                ) : null}
                {canEditTitle && showTitleEditButton ? (
                  <button
                    {...stylex.props(sessionStyles.titleEditButton)}
                    type="button"
                    aria-label="Edit OpenCode session title"
                    title="Edit OpenCode session title"
                    onClick={() => {
                      setTitleDraft(session?.opencodeTitle || "");
                      setEditingTitle(true);
                    }}
                  >
                    ✎
                  </button>
                ) : null}
              </div>
            )}
          </div>
          {sessionId && sessionId !== "default" ? (
            <Link {...stylex.props(sessionStyles.noteSub)} to={`/ses/${sessionId}/notes`}>
              {lastNoteFirstLine && lastNoteFirstLine.trim().length > 0
                ? lastNoteFirstLine
                : "+ Add note"}
            </Link>
          ) : null}
          <WaitingStateChip
            sessionId={sessionId}
            refreshKey={waitingStateRefreshKey}
            onCannedMessage={handleCannedMessage}
          />
          {capabilities.openCodeActivityPreview ? (
            <OpenCodeActivityPreview
              onActivityStatusChange={applyActivityStatus}
              onRequestCompact={requestOpenCodeCompact}
              onRefreshSessionPage={refreshSessionPage}
              sessionId={sessionId}
            />
          ) : null}
          <ClaudeActivity activity={externalCliActivity} sessionId={sessionId} />
          <CursorActivity activity={externalCliActivity} sessionId={sessionId} />
          <CodexActivity activity={externalCliActivity} sessionId={sessionId} />
          <GrokActivity activity={externalCliActivity} sessionId={sessionId} />
          <PaseoActivity activity={externalCliActivity} sessionId={sessionId} />
          {sessionId ? (
            <SessionTimerSummary
              createHref={`/jarvis/timers/new?sessionId=${encodeURIComponent(sessionId)}`}
              sessionId={sessionId}
              setError={setError}
              timersHref={`/ses/${sessionId}/timers`}
            />
          ) : null}
        </>
      }
    >
      <MessageComposer
        agentReplyMode={agentReplyMode}
        onSend={(pendingMessage) => {
          setError("");
          return sendOptimisticMessage(pendingMessage);
        }}
        onSendDing={playSendDing}
        onSoundEnabled={() => {
          setSoundEnabled(true);
          setShowEnableSound(false);
          setShowEnableNotif(false);
        }}
        onWarmSendDing={warmSendDing}
        onSetAgentReplyMode={setAgentReplyMode}
        onSetUseCli={setUseCli}
        onStopSpeech={() => stopPlayback(activeMessage, { markAllPlayed: true })}
        isSpeechActive={!!activeMessage || !!browserPlayback.messageId}
        opencodeStatus={session?.opencodeStatus}
        pendingId={() => `pending-${Date.now()}-${pendingCounter.current++}`}
        session={session}
        sessionId={sessionId}
        useCli={useCli}
        appendTextRef={appendToComposerRef}
      />

      {showEnableSound ? (
        <FloatingActionButton onClick={enableSound}>Enable sound</FloatingActionButton>
      ) : null}
      {showEnableNotif ? (
        <FloatingActionButton onClick={enableNotifications}>
          Enable notifications
        </FloatingActionButton>
      ) : null}

      {error ? (
        <div {...stylex.props(misc.error)} role="alert">
          {error}
        </div>
      ) : null}

      <section {...stylex.props(card.base, queue.panel)}>
        <div {...stylex.props(queue.heading)}>
          <h2 {...stylex.props(queue.headingH2)}>Messages</h2>
          <span {...stylex.props(queue.headingCount)}>
            {waitingCount} waiting, {playedCount} played
          </span>
        </div>
        {messages.length === 0 ? (
          <p {...stylex.props(misc.empty)}>No messages yet.</p>
        ) : (
          <MessageList
            messages={orderedMessages}
            onDelete={deleteMessage}
            onTogglePinned={togglePinned}
            onPlay={playMessage}
            onRetryPendingMessage={retryPendingMessage}
            onRetryOpenCodeDelivery={retryOpenCodeDelivery}
            onStop={stopPlayback}
            speakingId={speakingId}
          />
        )}
      </section>
    </PageShell>
  );
}
