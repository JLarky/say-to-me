import type { CSSProperties } from "react";

import type { Message, MessageSessionReference, Session } from "./types.ts";

/** Statuses that leave the voice queue (played, done, or overflow-evicted). */
export const playedStatuses = new Set(["played", "done", "skipped"]);

export type AgentReplyMode = "speak" | "shush" | "manual";

const lastOpenCodeLinkKey = "say-to-me-last-opencode-link";
const lastPaseoLinkKey = "say-to-me-last-paseo-link";

export type LastOpenCodeLink = "local" | "tailscale";
export type LastPaseoLink = "local" | "tailscale";

export function getLastOpenCodeLink(): LastOpenCodeLink | null {
  try {
    const value = localStorage.getItem(lastOpenCodeLinkKey);
    return value === "local" || value === "tailscale" ? value : null;
  } catch {
    return null;
  }
}

export function saveLastOpenCodeLink(value: LastOpenCodeLink): void {
  try {
    localStorage.setItem(lastOpenCodeLinkKey, value);
  } catch {
    // localStorage may be unavailable; ignore
  }
}

export function getLastPaseoLink(): LastPaseoLink | null {
  try {
    const value = localStorage.getItem(lastPaseoLinkKey);
    return value === "local" || value === "tailscale" ? value : null;
  } catch {
    return null;
  }
}

export function saveLastPaseoLink(value: LastPaseoLink): void {
  try {
    localStorage.setItem(lastPaseoLinkKey, value);
  } catch {
    // localStorage may be unavailable; ignore
  }
}

export function buildMessages(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => messageSortValue(b) - messageSortValue(a));
}

function messageSortValue(message: Message): number {
  if (typeof message.id === "number") return message.id;
  const createdAt = new Date(message.createdAt ?? "").getTime();
  return Number.isNaN(createdAt) ? 0 : createdAt;
}

export function formatMessageTime(value: string | null | undefined, now = new Date()): string {
  if (!value) return "";
  const date = new Date(value.endsWith?.("Z") ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 12 * 60) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function shouldSubmitComposerKey(event: {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing: boolean };
}): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;
}

export function composerSubmitIntent(event: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  nativeEvent: { isComposing: boolean };
}): "send" | "force" | null {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return null;
  return event.metaKey || event.ctrlKey ? "force" : "send";
}

export function createPendingMessage({
  author,
  sessionId,
  text,
  id = `pending-${Date.now()}`,
  images,
  useCli,
  forceOpencode,
  notifyOnCompletion,
  targetSessionId,
}: {
  author: Message["author"];
  sessionId: string;
  text: string;
  id?: string;
  images?: string[];
  useCli?: boolean;
  forceOpencode?: boolean;
  notifyOnCompletion?: boolean;
  targetSessionId?: string | null;
}): Message {
  return {
    id,
    author,
    sessionId,
    text,
    status: "pending",
    createdAt: new Date().toISOString(),
    pending: true,
    images,
    useCli,
    forceOpencode,
    notifyOnCompletion,
    targetSessionId,
  };
}

export function mergeMessagesWithPending(
  serverMessages: Message[],
  currentMessages: Message[],
): Message[] {
  const serverIds = new Set(serverMessages.map((m) => m.id));
  const serverKeys = new Set(serverMessages.map((m) => `${m.author}:${m.text}`));
  const pendingMessages = currentMessages.filter(
    (message) =>
      message.pending &&
      !serverIds.has(message.id) &&
      !serverKeys.has(`${message.author}:${message.text}`),
  );
  return [...serverMessages, ...pendingMessages];
}

export function upsertPendingMessage(messages: Message[], pendingMessage: Message): Message[] {
  return messages.some((message) => message.id === pendingMessage.id)
    ? messages.map((message) => (message.id === pendingMessage.id ? pendingMessage : message))
    : [pendingMessage, ...messages];
}

export function failPendingMessage(
  messages: Message[],
  pendingId: number | string,
  error: string,
): Message[] {
  return messages.map((message) =>
    message.id === pendingId ? { ...message, status: "failed", pending: true, error } : message,
  );
}

export function replacePendingMessage(
  messages: Message[],
  pendingId: number | string,
  serverMessage: Message | null,
): Message[] {
  const withoutPending = messages.filter((message) => message.id !== pendingId);
  if (!serverMessage || withoutPending.some((message) => message.id === serverMessage.id)) {
    return withoutPending;
  }
  return [serverMessage, ...withoutPending];
}

export function recentMessageLinks(messages: Message[], limit = 3): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  for (const message of buildMessages(messages)) {
    for (const link of message.links || []) {
      if (seen.has(link)) continue;
      seen.add(link);
      links.push(link);
      if (links.length >= limit) return links;
    }
  }

  return links;
}

export function recentMessageSessions(
  messages: Message[],
  limit = 3,
  excludeSessionId?: string,
): MessageSessionReference[] {
  const sessions: MessageSessionReference[] = [];
  const seen = new Set<string>();

  for (const message of buildMessages(messages)) {
    for (const session of message.sessions || []) {
      if (session.id === excludeSessionId) continue;
      if (seen.has(session.id)) continue;
      seen.add(session.id);
      sessions.push(session);
      if (sessions.length >= limit) return sessions;
    }
  }

  return sessions;
}

export function compactLinkLabel(link: string, maxLength = 48): string {
  let label = link;
  try {
    const url = new URL(link);
    label = `${url.hostname}${decodeURIComponent(url.pathname)}`;
  } catch {
    // Fall back to the raw string for non-URL links.
  }

  return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}

function pathBasename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const leaf = trimmed.split(/[/\\]/).pop();
  return leaf || trimmed;
}

function normalizePath(path: string): string {
  return path.replace(/[/\\]+$/, "");
}

export function hasDistinctOpenCodeWorkspace(
  session: Pick<Session, "opencodeWorkspaceId" | "opencodeDirectory" | "opencodeWorktree">,
): boolean {
  if (session.opencodeWorkspaceId) return true;
  const { opencodeDirectory, opencodeWorktree } = session;
  if (!opencodeDirectory || !opencodeWorktree) return false;
  return normalizePath(opencodeDirectory) !== normalizePath(opencodeWorktree);
}

export function openCodeProjectSegment(
  session: Pick<Session, "opencodeProjectName" | "opencodeWorktree" | "opencodeDirectory">,
): string | null {
  return (
    session.opencodeProjectName ||
    (session.opencodeWorktree ? pathBasename(session.opencodeWorktree) : null) ||
    (session.opencodeDirectory ? pathBasename(session.opencodeDirectory) : null)
  );
}

function shortOpenCodeId(id: string): string {
  return id.replace(/^[a-z]+_/, "").slice(0, 6);
}

export function openCodeWorkspaceSegment(
  session: Pick<Session, "opencodeBranch" | "opencodeDirectory" | "opencodeWorkspaceId">,
): string | null {
  return (
    (session.opencodeDirectory ? pathBasename(session.opencodeDirectory) : null) ||
    session.opencodeBranch ||
    (session.opencodeWorkspaceId
      ? `workspace-${shortOpenCodeId(session.opencodeWorkspaceId)}`
      : null)
  );
}

export type OpenCodeLabelSegment = { text: string; kind: "project" | "workspace" };

export function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const binary = atob(`${normalized}${padding}`);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function sessionsHref(workspacePath: string): string {
  return `/sessions/${base64UrlEncode(workspacePath)}`;
}

export function importSessionsHref(
  workspacePath: string,
  options?: { provider?: "claude" | "codex" | "cursor" | "grok" },
): string {
  const params = new URLSearchParams();
  if (options?.provider && options.provider !== "claude") {
    params.set("provider", options.provider);
  }
  const query = params.toString();
  return `${sessionsHref(workspacePath)}${query ? `?${query}` : ""}`;
}

export function openCodeWorkspaceKey(
  session: Pick<Session, "opencodeWorkspaceId" | "opencodeDirectory">,
): string | null {
  if (session.opencodeWorkspaceId) return session.opencodeWorkspaceId;
  return session.opencodeDirectory ? base64UrlEncode(session.opencodeDirectory) : null;
}

export function projectFilterHref(projectId: string): string {
  return `/project/${projectId}`;
}

export function workspaceFilterHref(projectId: string, workspaceKey: string): string {
  return `/project/${projectId}/workspace/${workspaceKey}`;
}

type ExistingContextSession = Pick<
  Session,
  "id" | "opencodeProjectId" | "opencodeWorkspaceId" | "opencodeDirectory" | "opencodeWorktree"
>;

/**
 * Pick the best existing project/workspace/session route for a resolved
 * absolute path, or null when nothing matches. Used by `/sessions` to offer a
 * single "List existing sessions" jump instead of listing matches inline.
 *
 * Precedence:
 *  1. A session whose `opencodeDirectory` equals the path and is a *distinct*
 *     workspace (separate checkout) → that workspace's page.
 *  2. A session whose `opencodeWorktree` equals the path (a project root) →
 *     that project's page. This wins for a plain checkout, where directory and
 *     worktree are the same.
 *  3. Any remaining `opencodeDirectory` match → its workspace page when a
 *     project id exists, else the session itself.
 */
export function existingContextHref(
  sessions: ExistingContextSession[],
  resolvedPath: string,
): string | null {
  const target = normalizePath(resolvedPath);
  const directoryMatches = sessions.filter(
    (session) => session.opencodeDirectory && normalizePath(session.opencodeDirectory) === target,
  );

  for (const session of directoryMatches) {
    if (session.opencodeProjectId && hasDistinctOpenCodeWorkspace(session)) {
      const key = openCodeWorkspaceKey(session);
      if (key) return workspaceFilterHref(session.opencodeProjectId, key);
    }
  }

  const worktreeMatch = sessions.find(
    (session) =>
      session.opencodeProjectId &&
      session.opencodeWorktree &&
      normalizePath(session.opencodeWorktree) === target,
  );
  if (worktreeMatch?.opencodeProjectId) return projectFilterHref(worktreeMatch.opencodeProjectId);

  const directoryMatch = directoryMatches[0];
  if (directoryMatch) {
    if (directoryMatch.opencodeProjectId) {
      const key = openCodeWorkspaceKey(directoryMatch);
      if (key) return workspaceFilterHref(directoryMatch.opencodeProjectId, key);
    }
    return directoryMatch.id === "default" ? "/default" : `/ses/${directoryMatch.id}`;
  }

  return null;
}

export function openCodeContextLabel(
  session: Pick<
    Session,
    | "opencodeProjectName"
    | "opencodeProjectId"
    | "opencodeWorkspaceId"
    | "opencodeWorktree"
    | "opencodeDirectory"
    | "opencodeBranch"
  >,
): { segments: OpenCodeLabelSegment[]; title: string } | null {
  const project = openCodeProjectSegment(session);
  const workspace = hasDistinctOpenCodeWorkspace(session)
    ? openCodeWorkspaceSegment(session)
    : null;

  const segments: OpenCodeLabelSegment[] = [];
  if (project) segments.push({ text: project, kind: "project" });
  if (workspace && workspace !== project) segments.push({ text: workspace, kind: "workspace" });

  if (!segments.length) {
    const id = session.opencodeProjectId;
    return id ? { segments: [{ text: id, kind: "project" }], title: id } : null;
  }

  const full = segments.map((segment) => segment.text).join(" / ");
  const showsWorkspace = segments.some((segment) => segment.kind === "workspace");
  const debugParts = [full];
  if (session.opencodeBranch && !showsWorkspace) {
    debugParts.push(`branch: ${session.opencodeBranch}`);
  }
  const labelWithDebug = debugParts.join(" - ");
  const title = session.opencodeProjectId
    ? `${labelWithDebug} (${session.opencodeProjectId})`
    : labelWithDebug;
  return { segments, title };
}

export type ExternalCliProvider = "claude" | "codex" | "cursor" | "grok";

const externalCliProviderLabels: Record<ExternalCliProvider, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
};

function externalCliProviderFromBackend(
  backend: Session["backend"] | undefined,
): ExternalCliProvider | null {
  if (backend === "claude" || backend === "codex" || backend === "cursor" || backend === "grok") {
    return backend;
  }
  return null;
}

/**
 * Context badge for external CLI sessions: `Cursor / llm-usage`, linking to
 * `/sessions/<base64url(cwd)>`. Skipped when an OpenCode context badge applies.
 */
export function cliContextLabel(
  session: Pick<
    Session,
    | "backend"
    | "cwd"
    | "opencodeProjectId"
    | "opencodeProjectName"
    | "opencodeWorkspaceId"
    | "opencodeWorktree"
    | "opencodeDirectory"
    | "opencodeBranch"
  >,
): {
  providerLabel: string;
  folderLabel: string;
  href: string;
  title: string;
} | null {
  if (openCodeContextLabel(session)) return null;

  const provider = externalCliProviderFromBackend(session.backend);
  if (!provider) return null;

  const cwd = session.cwd?.trim();
  if (!cwd) return null;

  const folderLabel = pathBasename(cwd);
  const providerLabel = externalCliProviderLabels[provider];
  const href = sessionsHref(cwd);
  const title = `${providerLabel} / ${folderLabel} (${cwd})`;
  return { providerLabel, folderLabel, href, title };
}

export function projectPattern(icon: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><text x="24" y="24" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="22" font-weight="900" fill="rgba(23,32,42,0.16)">${icon}</text><text x="72" y="72" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="22" font-weight="900" fill="rgba(23,32,42,0.16)">${icon}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const projectIdentityIcons = ["◆", "●", "▲", "■", "⬟", "✦", "✚", "✹"] as const;

function hashProjectKey(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function projectIdentity(session: Pick<Session, "id" | "opencodeTitle">): {
  color: string;
  icon: string;
  label: string;
} {
  const hash = hashProjectKey(session.id);
  const hue = hash % 360;
  const saturation = 28 + ((hash >>> 8) % 15);
  const lightness = 80 + ((hash >>> 16) % 9);
  return {
    color: `hsl(${hue} ${saturation}% ${lightness}%)`,
    icon: projectIdentityIcons[hash % projectIdentityIcons.length],
    label: session.opencodeTitle || session.id,
  };
}

export function projectThemeStyle(
  identity: Pick<ReturnType<typeof projectIdentity>, "color" | "icon">,
): CSSProperties {
  return {
    "--project-bg": identity.color,
    "--project-pattern": projectPattern(identity.icon),
  } as CSSProperties;
}
