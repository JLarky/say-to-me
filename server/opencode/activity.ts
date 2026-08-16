import { type as arktype } from "arktype";
import { Duration, Effect } from "effect";
import { opencodeDirectory, opencodeStatusTimeoutMs } from "../config.ts";
import { getOpenCodeSessionInfo } from "./client.ts";
import { openCodeBaseUrl, openCodeFetch } from "./http.ts";
import { safeJsonParse, UnknownJson } from "@say-to-me/runtime-validation";
import { assistantMessageInfoId, openCodeMessageInfoError } from "./message-error.ts";
import { validateSessionId } from "../session-id.ts";
import type { SseClient } from "../sse/client.ts";
import { writeSseEvent } from "../sse/client.ts";
import { withActivitySnippetHtml } from "../markdown/extra-markdown-html.ts";

type OpenCodeActivityStatus = "busy" | "awaiting-input" | "idle" | "retrying" | "error" | "unknown";

type OpenCodeContextUsage = {
  usedTokens: number | null;
  limitTokens: number | null;
  percent: number | null;
  source: "latestMessageTokens";
};

type OpenCodeActivityPreview = {
  saySessionId: string;
  linkedOpenCodeSessionId: string | null;
  status: OpenCodeActivityStatus;
  statusRaw: unknown;
  latestOutputSnippet: string | null;
  latestActivityTimestamp: number | null;
  freshness: { checkedAt: number; ageMs: number | null; stale: boolean | null };
  metrics: {
    fetchDurationMs: number;
    payloadBytes: number;
    statusPayloadBytes: number;
    sessionPayloadBytes: number;
    messagesPayloadBytes: number;
    legacyMessagesPayloadBytes: number;
    messageCount: number;
    legacyMessageCount: number;
    limit: number;
  };
  capabilities: {
    status: "ok" | "missing" | "unknown";
    sessionMetadata: "ok" | "missing" | "unknown";
    v2Messages: "ok" | "missing" | "unknown";
    legacyMessages: "ok" | "missing" | "unknown";
  };
  previewSource: "legacy" | "v2" | "sse" | null;
  identifiers: {
    messageId: string | null;
    partId: string | null;
    eventId: string | null;
    runId: string | null;
  };
  contextUsage: OpenCodeContextUsage | null;
  recentItems: RecentActivityItem[];
  partialLiveUpdates: boolean;
  awaitingQuestionText: string | null;
  notes: string[];
};

type OpenCodeModelMetadataValue = {
  id?: string;
  providerID?: string;
  api?: { id?: string };
  limit?: { context?: number };
};

const OpenCodeMessageInfoTokens = arktype({ tokens: { total: "number >= 0" } });
const OpenCodeMessagePartTokens = arktype({ tokens: { total: "number >= 0" } });
const OpenCodeModelList = arktype({ data: "unknown[]" });
const OpenCodeModelMetadata = arktype({
  "id?": "string",
  "providerID?": "string",
  "api?": { "id?": "string" },
  "limit?": { "context?": "number > 0" },
});
const OpenCodeSessionModel = arktype({ "id?": "string", "providerID?": "string" });
const OpenCodeProvidersConfig = arktype({
  providers: "unknown[]",
});
const OpenCodeProviderConfig = arktype({
  "id?": "string",
  models: "unknown",
});
const OpenCodeProviderModelMap = arktype("unknown");

async function fetchOpenCodeDebugJson(url: URL): Promise<{
  ok: boolean;
  status: number;
  bytes: number;
  durationMs: number;
  data: unknown;
  error: string | null;
}> {
  const started = performance.now();
  try {
    const response = await openCodeFetch(url, {
      signal: AbortSignal.timeout(opencodeStatusTimeoutMs),
    });
    const text = await response.text();
    const bytes = Buffer.byteLength(text);
    const durationMs = Math.round(performance.now() - started);
    const parsed = text ? safeJsonParse(UnknownJson, text) : null;
    const error = text && parsed === null ? "Response was not JSON." : null;
    const data = parsed ?? null;
    return { ok: response.ok && !error, status: response.status, bytes, durationMs, data, error };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      bytes: 0,
      durationMs: Math.round(performance.now() - started),
      data: null,
      error: (error as Error).message || "OpenCode request failed.",
    };
  }
}

function debugOpenCodeUrl(pathname: string): URL {
  const baseUrl = openCodeBaseUrl();
  return new URL(pathname, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
}

function rawOpenCodeActivityStatus(value: unknown): OpenCodeActivityStatus {
  if (value && typeof value === "object" && "type" in value) {
    const type = (value as { type?: unknown }).type;
    if (type === "busy") return "busy";
    if (type === "idle") return "idle";
    if (type === "retry") return "retrying";
    if (type === "error") return "error";
  }
  return "unknown";
}

function openCodeStatusMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" ? compactSnippet(message) : null;
}

function compactSnippet(value: string | null | undefined): string | null {
  const snippet = value?.trim();
  if (!snippet) return null;
  return snippet;
}

function latestMessageTokenUsage(
  messagesData: unknown,
  modelData: unknown,
  providersData: unknown,
  sessionModel: unknown,
): OpenCodeContextUsage | null {
  if (!Array.isArray(messagesData)) return null;
  let latest: { timestamp: number; total: number } | null = null;
  for (const message of messagesData) {
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const item = message as { info?: unknown; parts?: unknown };
    const timestamp = newestTimestampFrom(message) ?? 0;
    const total = messageTokenTotal(item.info) ?? messagePartTokenTotal(item.parts);
    if (total == null) continue;
    if (!latest || timestamp >= latest.timestamp) latest = { timestamp, total };
  }
  const usedTokens = latest?.total ?? null;
  if (usedTokens == null) return null;

  const limitTokens = modelContextLimit(modelData, providersData, sessionModel);
  return {
    usedTokens,
    limitTokens,
    percent:
      limitTokens != null && limitTokens > 0
        ? Math.round((usedTokens / limitTokens) * 1000) / 10
        : null,
    source: "latestMessageTokens",
  };
}

function messageTokenTotal(info: unknown): number | null {
  const parsed = OpenCodeMessageInfoTokens(info);
  if (parsed instanceof arktype.errors) return null;
  return parsed.tokens.total;
}

function messagePartTokenTotal(parts: unknown): number | null {
  if (!Array.isArray(parts)) return null;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    const parsed = OpenCodeMessagePartTokens(part);
    if (!(parsed instanceof arktype.errors)) return parsed.tokens.total;
  }
  return null;
}

function providerModelContextLimit(
  providersData: unknown,
  desiredId: string | null,
  desiredProvider: string | null,
): number | null {
  const config = OpenCodeProvidersConfig(providersData);
  if (config instanceof arktype.errors) return null;
  const parsedProviders: { id: string | null; models: Record<string, unknown> }[] = [];
  for (const provider of config.providers) {
    const parsed = OpenCodeProviderConfig(provider);
    if (parsed instanceof arktype.errors) continue;
    const models = OpenCodeProviderModelMap(parsed.models);
    if (models instanceof arktype.errors || !models || typeof models !== "object") continue;
    parsedProviders.push({
      id: parsed.id ?? null,
      models: models as Record<string, unknown>,
    });
  }
  const providerMatches = desiredProvider
    ? parsedProviders.filter((provider) => provider.id === desiredProvider)
    : parsedProviders;
  const searchProviders = providerMatches.length > 0 ? providerMatches : parsedProviders;
  for (const provider of searchProviders) {
    if (!desiredId) continue;
    const model = provider.models[desiredId];
    const parsed = OpenCodeModelMetadata(model);
    if (!(parsed instanceof arktype.errors) && parsed.limit?.context != null) {
      return parsed.limit.context;
    }
  }
  if (!desiredId) return null;
  for (const provider of parsedProviders) {
    const model = provider.models[desiredId];
    const parsed = OpenCodeModelMetadata(model);
    if (!(parsed instanceof arktype.errors) && parsed.limit?.context != null) {
      return parsed.limit.context;
    }
  }
  return null;
}

function modelContextLimit(
  modelData: unknown,
  providersData: unknown,
  sessionModel: unknown,
): number | null {
  const desired = OpenCodeSessionModel(sessionModel);
  const desiredId = desired instanceof arktype.errors ? null : (desired.id ?? null);
  const desiredProvider = desired instanceof arktype.errors ? null : (desired.providerID ?? null);
  const modelList = OpenCodeModelList(modelData);
  if (!(modelList instanceof arktype.errors)) {
    const parsedModels: OpenCodeModelMetadataValue[] = [];
    for (const model of modelList.data) {
      const parsed = OpenCodeModelMetadata(model);
      if (!(parsed instanceof arktype.errors)) parsedModels.push(parsed);
    }
    const matches = parsedModels.filter((item) => {
      const id = item.id ?? null;
      const apiId = item.api?.id ?? null;
      const provider = item.providerID ?? null;
      if (desiredId && id !== desiredId && apiId !== desiredId) return false;
      if (desiredProvider && provider !== desiredProvider) return false;
      return true;
    });
    const fallbackMatches =
      matches.length > 0 || !desiredId
        ? matches
        : parsedModels.filter((item) => item.id === desiredId || item.api?.id === desiredId);
    for (const model of fallbackMatches) {
      if (model.limit?.context != null) return model.limit.context;
    }
  }
  return providerModelContextLimit(providersData, desiredId, desiredProvider);
}

type ActivityPartSummary = {
  kind: "thinking" | "compaction";
  snippet: string;
};

type RecentActivityItem = {
  kind: "message" | "tool" | "thinking" | "compaction" | "question";
  snippet: string;
  snippetHtml?: string;
  questionText?: string | null;
  messageId: string | null;
  partId: string | null;
  timestamp: number | null;
  partial: boolean;
  source: "legacy" | "sse" | "v2";
};

/** Always attach snippetHtml; seed one card from latestOutputSnippet when items empty. */
function ensureRecentItemsWithHtml({
  recentItems,
  latestOutputSnippet,
  messageId,
  partId,
  timestamp,
  partial,
  source,
}: {
  recentItems: RecentActivityItem[];
  latestOutputSnippet: string | null | undefined;
  messageId: string | null;
  partId: string | null;
  timestamp: number | null;
  partial: boolean;
  source: "legacy" | "sse" | "v2";
}): Array<RecentActivityItem & { snippetHtml: string }> {
  const withHtml = withActivitySnippetHtml(recentItems);
  if (withHtml.length > 0) return withHtml;
  const snippet = typeof latestOutputSnippet === "string" ? latestOutputSnippet.trim() : "";
  if (!snippet) return withHtml;
  return withActivitySnippetHtml([
    {
      kind: "message",
      snippet,
      messageId,
      partId,
      timestamp,
      partial,
      source,
    },
  ]);
}

function textFromUnknown(value: unknown): string | null {
  return typeof value === "string" ? compactSnippet(value) : null;
}

function textFromContentItems(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const text = textFromUnknown((item as { text?: unknown }).text);
    if (text) return text;
  }
  return null;
}

function activityPartSummary(part: {
  type?: unknown;
  text?: unknown;
  summary?: unknown;
  state?: { text?: unknown; content?: unknown; output?: unknown; summary?: unknown };
}): ActivityPartSummary | null {
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  const text =
    textFromUnknown(part.text) ??
    textFromUnknown(part.summary) ??
    textFromUnknown(part.state?.text) ??
    textFromUnknown(part.state?.summary) ??
    textFromContentItems(part.state?.content) ??
    textFromUnknown(part.state?.output);

  if (type.includes("think") || type.includes("reason")) {
    return { kind: "thinking", snippet: text ? `Thinking: ${text}` : "Thinking…" };
  }
  if (type.includes("compact") || type.includes("summar")) {
    return {
      kind: "compaction",
      snippet: text ? `Compacted context: ${text}` : "Compacted conversation context.",
    };
  }
  return null;
}

function isCompactionMessageInfo(info: unknown) {
  if (!info || typeof info !== "object") return false;
  const messageInfo = info as { agent?: unknown; mode?: unknown; summary?: unknown };
  return (
    messageInfo.mode === "compaction" ||
    messageInfo.agent === "compaction" ||
    messageInfo.summary === true
  );
}

function compactionSnippet(text: string | null) {
  return text ? `Compacted context: ${text}` : "Compacted conversation context.";
}

function eventActivitySummary(type: unknown): ActivityPartSummary | null {
  const eventType = typeof type === "string" ? type.toLowerCase() : "";
  if (eventType.includes("compact") || eventType.includes("summar")) {
    return { kind: "compaction", snippet: "Compacted conversation context." };
  }
  if (eventType.includes("think") || eventType.includes("reason")) {
    return { kind: "thinking", snippet: "Thinking…" };
  }
  return null;
}

function newestTimestampFrom(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const time = (value as { time?: { updated?: unknown; completed?: unknown; created?: unknown } })
    .time;
  for (const candidate of [time?.updated, time?.completed, time?.created]) {
    if (typeof candidate === "number") return candidate;
  }
  return null;
}

function latestOutputSnippetFrom(items: unknown[]): string | null {
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const message = item as {
      text?: unknown;
      output?: unknown;
      summary?: unknown;
      content?: Array<unknown>;
    };
    if (typeof message.text === "string") return compactSnippet(message.text);
    if (typeof message.output === "string") return compactSnippet(message.output);
    if (typeof message.summary === "string") return compactSnippet(message.summary);
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (!part || typeof part !== "object") continue;
        const content = part as {
          text?: unknown;
          state?: { content?: Array<unknown>; error?: unknown };
        };
        if (typeof content.text === "string") return compactSnippet(content.text);
        const toolContent = content.state?.content;
        if (Array.isArray(toolContent)) {
          for (const toolPart of toolContent) {
            if (toolPart && typeof toolPart === "object") {
              const text = (toolPart as { text?: unknown }).text;
              if (typeof text === "string") return compactSnippet(text);
            }
          }
        }
        if (typeof content.state?.error === "string") return compactSnippet(content.state.error);
      }
    }
  }
  return null;
}

export async function getOpenCodeActivityPreview(
  sessionId: string,
  limit: number,
): Promise<OpenCodeActivityPreview> {
  const checkedAt = Date.now();
  const notes: string[] = [];
  const result: OpenCodeActivityPreview = {
    saySessionId: sessionId,
    linkedOpenCodeSessionId: null as string | null,
    status: "unknown" as OpenCodeActivityStatus,
    statusRaw: null,
    latestOutputSnippet: null as string | null,
    latestActivityTimestamp: null as number | null,
    freshness: {
      checkedAt,
      ageMs: null as number | null,
      stale: null as boolean | null,
    },
    metrics: {
      fetchDurationMs: 0,
      payloadBytes: 0,
      statusPayloadBytes: 0,
      sessionPayloadBytes: 0,
      messagesPayloadBytes: 0,
      legacyMessagesPayloadBytes: 0,
      messageCount: 0,
      legacyMessageCount: 0,
      limit,
    },
    capabilities: {
      status: "unknown" as "ok" | "missing" | "unknown",
      sessionMetadata: "unknown" as "ok" | "missing" | "unknown",
      v2Messages: "unknown" as "ok" | "missing" | "unknown",
      legacyMessages: "unknown" as "ok" | "missing" | "unknown",
    },
    previewSource: null as "legacy" | "v2" | "sse" | null,
    identifiers: {
      messageId: null as string | null,
      partId: null as string | null,
      eventId: null as string | null,
      runId: null as string | null,
    },
    contextUsage: null as OpenCodeContextUsage | null,
    recentItems: [] as RecentActivityItem[],
    partialLiveUpdates: false,
    awaitingQuestionText: null as string | null,
    notes,
  };

  if (!validateSessionId(sessionId) || sessionId === "default") {
    notes.push("No linked OpenCode session id: Say session id is not an OpenCode ses_* id.");
    return result;
  }

  const activityDirectory =
    (await getOpenCodeSessionInfo(sessionId))?.directory || opencodeDirectory;
  const statusUrl = debugOpenCodeUrl("/session/status");
  statusUrl.searchParams.set("directory", activityDirectory);
  const sessionUrl = debugOpenCodeUrl(`/session/${sessionId}`);
  sessionUrl.searchParams.set("directory", activityDirectory);
  const messagesUrl = debugOpenCodeUrl(`/api/session/${sessionId}/message`);
  messagesUrl.searchParams.set("directory", activityDirectory);
  messagesUrl.searchParams.set("limit", String(limit));
  messagesUrl.searchParams.set("order", "desc");
  const legacyMessagesUrl = debugOpenCodeUrl(`/session/${sessionId}/message`);
  legacyMessagesUrl.searchParams.set("directory", activityDirectory);
  legacyMessagesUrl.searchParams.set("limit", String(limit));
  legacyMessagesUrl.searchParams.set("order", "desc");
  const modelsUrl = debugOpenCodeUrl("/api/model");
  modelsUrl.searchParams.set("directory", activityDirectory);
  const providersUrl = debugOpenCodeUrl("/config/providers");
  providersUrl.searchParams.set("directory", activityDirectory);

  const [
    statusResponse,
    sessionResponse,
    messagesResponse,
    legacyMessagesResponse,
    modelsResponse,
    providersResponse,
  ] = await Promise.all([
    fetchOpenCodeDebugJson(statusUrl),
    fetchOpenCodeDebugJson(sessionUrl),
    fetchOpenCodeDebugJson(messagesUrl),
    fetchOpenCodeDebugJson(legacyMessagesUrl),
    fetchOpenCodeDebugJson(modelsUrl),
    fetchOpenCodeDebugJson(providersUrl),
  ]);

  result.metrics.fetchDurationMs = Math.max(
    statusResponse.durationMs,
    sessionResponse.durationMs,
    messagesResponse.durationMs,
    legacyMessagesResponse.durationMs,
    modelsResponse.durationMs,
    providersResponse.durationMs,
  );
  result.metrics.statusPayloadBytes = statusResponse.bytes;
  result.metrics.sessionPayloadBytes = sessionResponse.bytes;
  result.metrics.messagesPayloadBytes = messagesResponse.bytes;
  result.metrics.legacyMessagesPayloadBytes = legacyMessagesResponse.bytes;
  result.metrics.payloadBytes =
    statusResponse.bytes +
    sessionResponse.bytes +
    messagesResponse.bytes +
    legacyMessagesResponse.bytes +
    modelsResponse.bytes +
    providersResponse.bytes;

  if (statusResponse.ok && statusResponse.data && typeof statusResponse.data === "object") {
    result.capabilities.status = "ok";
    const rawStatus = (statusResponse.data as Record<string, unknown>)[sessionId];
    result.statusRaw = rawStatus ?? null;
    result.status = rawOpenCodeActivityStatus(rawStatus);
    if (result.status === "retrying" || result.status === "error") {
      result.latestOutputSnippet = openCodeStatusMessage(rawStatus);
      result.latestActivityTimestamp = checkedAt;
    }
  } else {
    result.capabilities.status = "missing";
    notes.push(
      `OpenCode status unavailable: ${statusResponse.error || `HTTP ${statusResponse.status}`}.`,
    );
  }

  if (sessionResponse.ok && sessionResponse.data && typeof sessionResponse.data === "object") {
    result.capabilities.sessionMetadata = "ok";
    const session = sessionResponse.data as { id?: unknown };
    result.linkedOpenCodeSessionId = typeof session.id === "string" ? session.id : sessionId;
    result.latestActivityTimestamp = newestTimestampFrom(sessionResponse.data);
    if (result.status === "unknown" && !result.statusRaw) {
      result.status = "idle";
      notes.push(
        "Status inferred idle because session exists but /session/status did not include it.",
      );
    }
  } else {
    result.capabilities.sessionMetadata = "missing";
    notes.push(
      `OpenCode session metadata unavailable: ${
        sessionResponse.error || `HTTP ${sessionResponse.status}`
      }.`,
    );
  }

  if (messagesResponse.ok && messagesResponse.data && typeof messagesResponse.data === "object") {
    const items = Array.isArray((messagesResponse.data as { items?: unknown }).items)
      ? (messagesResponse.data as { items: unknown[] }).items
      : [];
    result.capabilities.v2Messages = "ok";
    result.metrics.messageCount = items.length;
    if (result.status !== "retrying" && result.status !== "error") {
      result.latestOutputSnippet = latestOutputSnippetFrom(items);
    }
    for (const item of items) {
      const timestamp = newestTimestampFrom(item);
      if (
        timestamp &&
        (!result.latestActivityTimestamp || timestamp > result.latestActivityTimestamp)
      ) {
        result.latestActivityTimestamp = timestamp;
      }
    }
    if (!result.latestOutputSnippet)
      notes.push("No text output found in latest v2 message preview.");
  } else {
    result.capabilities.v2Messages = "missing";
    notes.push(
      `OpenCode v2 messages unavailable: ${messagesResponse.error || `HTTP ${messagesResponse.status}`}.`,
    );
  }

  if (legacyMessagesResponse.ok) {
    const legacy = analyzeLegacyMessageSurface(legacyMessagesResponse.data);
    result.capabilities.legacyMessages = "ok";
    result.metrics.legacyMessageCount = legacy.messageCount;
    result.contextUsage ??= latestMessageTokenUsage(
      legacyMessagesResponse.data,
      modelsResponse.data,
      providersResponse.data,
      sessionResponse.data && typeof sessionResponse.data === "object"
        ? (sessionResponse.data as { model?: unknown }).model
        : null,
    );
    result.recentItems = legacy.recentItems;
    if (legacy.awaitingQuestionText && result.status === "busy") {
      result.status = "awaiting-input";
      result.awaitingQuestionText = legacy.awaitingQuestionText;
    }
    if (legacy.latestMessageError) {
      result.status = "error";
      result.latestOutputSnippet = legacy.latestMessageError;
      result.previewSource = "legacy";
      result.identifiers.messageId = legacy.identifiers.messageId;
      result.identifiers.partId = legacy.identifiers.partId;
      result.partialLiveUpdates = legacy.partialLiveUpdates;
    } else if (
      legacy.humanReadableLatestAssistantSnippet &&
      result.status !== "retrying" &&
      result.status !== "error"
    ) {
      result.latestOutputSnippet = legacy.humanReadableLatestAssistantSnippet;
      result.previewSource = "legacy";
      result.identifiers.messageId = legacy.identifiers.messageId;
      result.identifiers.partId = legacy.identifiers.partId;
      result.partialLiveUpdates = legacy.partialLiveUpdates;
    } else {
      notes.push("No text output found in latest legacy message preview.");
    }
    if (
      legacy.latestActivityTimestamp &&
      (!result.latestActivityTimestamp ||
        legacy.latestActivityTimestamp > result.latestActivityTimestamp)
    ) {
      result.latestActivityTimestamp = legacy.latestActivityTimestamp;
    }
  } else {
    result.capabilities.legacyMessages = "missing";
    notes.push(
      `OpenCode legacy messages unavailable: ${
        legacyMessagesResponse.error || `HTTP ${legacyMessagesResponse.status}`
      }.`,
    );
  }

  if (!result.previewSource && result.latestOutputSnippet) result.previewSource = "v2";

  if (result.latestActivityTimestamp) {
    result.freshness.ageMs = Math.max(0, checkedAt - result.latestActivityTimestamp);
    result.freshness.stale = result.freshness.ageMs > 30_000;
  }

  result.recentItems = ensureRecentItemsWithHtml({
    recentItems: result.recentItems,
    latestOutputSnippet: result.latestOutputSnippet,
    messageId: result.identifiers.messageId,
    partId: result.identifiers.partId,
    timestamp: result.latestActivityTimestamp,
    partial: result.partialLiveUpdates,
    source: result.previewSource ?? "v2",
  });
  return result;
}

function textFromToolContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const item of content) {
    if (item && typeof item === "object") {
      const text = (item as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

function analyzeV2MessageSurface(data: unknown) {
  const items = data && typeof data === "object" ? (data as { items?: unknown }).items : null;
  const messages = Array.isArray(items) ? items : [];
  const snippet = latestOutputSnippetFrom(messages);
  let messageId: string | null = null;
  let partId: string | null = null;
  let timestamp: number | null = null;
  let exposesToolOutput = false;

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const item = message as { id?: unknown; content?: unknown[] };
    if (!messageId && typeof item.id === "string") messageId = item.id;
    if (!timestamp) timestamp = newestTimestampFrom(item);
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!part || typeof part !== "object") continue;
        const content = part as { id?: unknown; type?: unknown; state?: { content?: unknown[] } };
        if (!partId && typeof content.id === "string") partId = content.id;
        if (content.type === "tool" && textFromToolContent(content.state?.content)) {
          exposesToolOutput = true;
        }
      }
    }
  }

  return {
    messageCount: messages.length,
    humanReadableLatestAssistantSnippet: snippet,
    exposesToolOutput,
    partialLiveUpdates: false,
    identifiers: { messageId, partId, runId: null as string | null },
    latestActivityTimestamp: timestamp,
  };
}

export function analyzeLegacyMessageSurface(data: unknown) {
  const messages = Array.isArray(data) ? data : [];
  let snippet: string | null = null;
  let fallbackToolSnippet: string | null = null;
  let messageId: string | null = null;
  let partId: string | null = null;
  let fallbackMessageId: string | null = null;
  let fallbackPartId: string | null = null;
  let fallbackActivitySnippet: string | null = null;
  let fallbackActivityMessageId: string | null = null;
  let fallbackActivityPartId: string | null = null;
  let timestamp: number | null = null;
  let exposesToolOutput = false;
  let generating = false;
  let awaitingQuestionText: string | null = null;
  let latestMessageError: string | null = null;

  const assistantMessages = messages
    .filter((rawMessage) => {
      if (!rawMessage || typeof rawMessage !== "object") return false;
      return (rawMessage as { info?: { role?: unknown } }).info?.role === "assistant";
    })
    .sort((a, b) => {
      const aInfo = (a as { info?: unknown }).info;
      const bInfo = (b as { info?: unknown }).info;
      return (newestTimestampFrom(bInfo) || 0) - (newestTimestampFrom(aInfo) || 0);
    });
  let recentItems = assistantMessages.flatMap(legacyMessageActivityItem).slice(0, 5);
  const newestAssistantInfo = assistantMessages[0]
    ? (assistantMessages[0] as { info?: unknown }).info
    : null;
  latestMessageError = openCodeMessageInfoError(newestAssistantInfo);

  if (latestMessageError) {
    snippet = latestMessageError;
    messageId = assistantMessageInfoId(newestAssistantInfo);
    partId = null;
    timestamp = newestTimestampFrom(newestAssistantInfo) ?? timestamp;
  } else {
    for (const rawMessage of assistantMessages) {
      const message = rawMessage as {
        info?: { id?: unknown; time?: { completed?: unknown } };
        parts?: unknown[];
      };
      const textParts: string[] = [];
      let textPartId: string | null = null;
      if (!timestamp) timestamp = newestTimestampFrom(message.info);
      generating ||= !message.info?.time?.completed;
      for (const rawPart of message.parts || []) {
        if (!rawPart || typeof rawPart !== "object") continue;
        const part = rawPart as {
          id?: unknown;
          type?: unknown;
          tool?: unknown;
          text?: unknown;
          state?: { status?: unknown; output?: unknown; error?: unknown; input?: unknown };
          summary?: unknown;
        };
        if (part.type === "text" && typeof part.text === "string") {
          const text = compactSnippet(part.text);
          if (text) {
            textParts.push(text);
            textPartId ??= typeof part.id === "string" ? part.id : null;
          }
        }
        if (part.type === "tool" && part.tool === "question" && part.state?.status === "running") {
          // Extract first question text from the running question tool
          const stateInput = part.state.input;
          if (stateInput && typeof stateInput === "object") {
            const questions = (stateInput as { questions?: unknown }).questions;
            if (Array.isArray(questions) && questions.length > 0) {
              const firstQ = questions[0] as { question?: unknown };
              if (typeof firstQ?.question === "string") {
                awaitingQuestionText ??= firstQ.question;
              }
            }
          }
        }
        if (part.type === "tool") {
          const toolText =
            typeof part.state?.output === "string"
              ? part.state.output
              : typeof part.state?.error === "string"
                ? part.state.error
                : null;
          if (toolText) {
            exposesToolOutput = true;
            if (!fallbackToolSnippet && !looksLikeCommandTransportOutput(toolText)) {
              fallbackToolSnippet = compactSnippet(toolText);
              fallbackMessageId = typeof message.info?.id === "string" ? message.info.id : null;
              fallbackPartId = typeof part.id === "string" ? part.id : null;
            }
          }
        }
        if (!fallbackActivitySnippet) {
          const activity = activityPartSummary(part);
          if (activity) {
            fallbackActivitySnippet = activity.snippet;
            fallbackActivityMessageId =
              typeof message.info?.id === "string" ? message.info.id : null;
            fallbackActivityPartId = typeof part.id === "string" ? part.id : null;
          }
        }
      }
      if (!snippet && textParts.length) {
        snippet = textParts.join("\n\n");
        messageId = typeof message.info?.id === "string" ? message.info.id : null;
        partId = textPartId;
      }
      if (snippet) break;
    }

    if (!snippet && fallbackToolSnippet) {
      snippet = fallbackToolSnippet;
      messageId = fallbackMessageId;
      partId = fallbackPartId;
    }

    if (!snippet && fallbackActivitySnippet) {
      snippet = fallbackActivitySnippet;
      messageId = fallbackActivityMessageId;
      partId = fallbackActivityPartId;
    }
  }

  if (latestMessageError) {
    recentItems = recentItems.filter((item) => item.snippet !== latestMessageError);
    recentItems.unshift({
      kind: "message",
      snippet: latestMessageError,
      messageId,
      partId: null,
      timestamp,
      partial: false,
      source: "legacy",
    });
  }

  return {
    messageCount: messages.length,
    humanReadableLatestAssistantSnippet: snippet,
    latestMessageError,
    exposesToolOutput,
    partialLiveUpdates: generating,
    identifiers: { messageId, partId, runId: null as string | null },
    latestActivityTimestamp: timestamp,
    recentItems,
    awaitingQuestionText,
  };
}

function legacyMessageActivityItem(rawMessage: unknown): RecentActivityItem[] {
  if (!rawMessage || typeof rawMessage !== "object") return [];
  const message = rawMessage as {
    info?: { id?: unknown; time?: { completed?: unknown; updated?: unknown; created?: unknown } };
    parts?: unknown[];
  };
  const textSnippets: string[] = [];
  let textPartId: string | null = null;
  let toolSnippet: string | null = null;
  let toolPartId: string | null = null;
  let activity: ActivityPartSummary | null = null;
  let activityPartId: string | null = null;
  let questionText: string | null = null;
  let questionPartId: string | null = null;

  for (const rawPart of message.parts || []) {
    if (!rawPart || typeof rawPart !== "object") continue;
    const part = rawPart as {
      id?: unknown;
      type?: unknown;
      tool?: unknown;
      text?: unknown;
      summary?: unknown;
      state?: {
        status?: unknown;
        output?: unknown;
        error?: unknown;
        text?: unknown;
        content?: unknown;
        summary?: unknown;
        input?: unknown;
      };
    };
    const partId = typeof part.id === "string" ? part.id : null;
    if (part.type === "text" && typeof part.text === "string") {
      const snippet = compactSnippet(part.text);
      if (snippet) {
        textSnippets.push(snippet);
        textPartId ??= partId;
      }
    }
    if (part.type === "tool" && part.tool === "question" && part.state?.status === "running") {
      if (!questionText) {
        const stateInput = part.state.input;
        if (stateInput && typeof stateInput === "object") {
          const questions = (stateInput as { questions?: unknown }).questions;
          if (Array.isArray(questions) && questions.length > 0) {
            const firstQ = questions[0] as { question?: unknown };
            if (typeof firstQ?.question === "string") {
              questionText = firstQ.question;
              questionPartId = partId;
            }
          }
        }
      }
    }
    if (!toolSnippet && part.type === "tool") {
      const toolText =
        typeof part.state?.output === "string"
          ? part.state.output
          : typeof part.state?.error === "string"
            ? part.state.error
            : null;
      if (toolText && !looksLikeCommandTransportOutput(toolText)) {
        toolSnippet = compactSnippet(toolText);
        toolPartId = partId;
      }
    }
    if (!activity) {
      activity = activityPartSummary(part);
      activityPartId = activity ? partId : null;
    }
  }

  const messageId = typeof message.info?.id === "string" ? message.info.id : null;
  const timestamp = newestTimestampFrom(message.info);
  const partial = !message.info?.time?.completed;
  const textSnippet = textSnippets.length ? textSnippets.join("\n\n") : null;
  if (isCompactionMessageInfo(message.info)) {
    return [
      {
        kind: "compaction" as const,
        snippet: textSnippet
          ? compactionSnippet(textSnippet)
          : (activity?.snippet ?? compactionSnippet(toolSnippet)),
        messageId,
        partId: textPartId ?? activityPartId ?? toolPartId,
        timestamp,
        partial,
        source: "legacy" as const,
      },
    ];
  }
  if (questionText) {
    const items: RecentActivityItem[] = [
      {
        kind: "question",
        snippet: questionText,
        questionText,
        messageId,
        partId: questionPartId,
        timestamp,
        partial,
        source: "legacy",
      },
    ];
    if (textSnippet) {
      items.push({
        kind: "message",
        snippet: textSnippet,
        messageId,
        partId: textPartId,
        timestamp,
        partial,
        source: "legacy",
      });
    }
    return items;
  }
  if (textSnippet) {
    return [
      {
        kind: "message" as const,
        snippet: textSnippet,
        messageId,
        partId: textPartId,
        timestamp,
        partial,
        source: "legacy" as const,
      },
    ];
  }
  if (toolSnippet) {
    return [
      {
        kind: "tool" as const,
        snippet: toolSnippet,
        messageId,
        partId: toolPartId,
        timestamp,
        partial,
        source: "legacy" as const,
      },
    ];
  }
  if (activity) {
    return [
      {
        kind: activity.kind,
        snippet: activity.snippet,
        messageId,
        partId: activityPartId,
        timestamp,
        partial,
        source: "legacy" as const,
      },
    ];
  }
  return [];
}

function looksLikeCommandTransportOutput(value: string) {
  const text = value.trim();
  return (
    text.startsWith("% Total") ||
    text.startsWith("Success. Updated the following files:") ||
    text.startsWith("Found ") ||
    text.startsWith("<path>") ||
    text.startsWith("diff --git ") ||
    /\bDload\s+Upload\s+Total\s+Spent\s+Left\s+Speed\b/.test(text) ||
    /\{"message":\{"id":/.test(text) ||
    /"opencodeDeliveryStatus"/.test(text)
  );
}

async function fetchOpenCodeSseSample(url: URL, sampleMs: number) {
  const started = performance.now();
  let status = 0;
  let bytes = 0;
  let buffered = "";
  const events: unknown[] = [];
  let error: string | null = null;

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await openCodeFetch(url, { signal });
          status = response.status;
          const reader = response.body?.getReader();
          if (!reader) throw new Error("No SSE response body.");
          const decoder = new TextDecoder();
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            buffered += decoder.decode(chunk.value, { stream: true });
            let boundary = buffered.indexOf("\n\n");
            while (boundary !== -1) {
              const rawEvent = buffered.slice(0, boundary).trim();
              buffered = buffered.slice(boundary + 2);
              const dataLine = rawEvent
                .split(/\n+/)
                .find((line) => line.startsWith("data:"))
                ?.replace(/^data:\s*/, "");
              if (dataLine) {
                const parsed = safeJsonParse(UnknownJson, dataLine);
                events.push(parsed ?? dataLine);
              }
              boundary = buffered.indexOf("\n\n");
            }
          }
        },
        catch: (caught) => caught,
      }).pipe(
        Effect.catchAll((caught) =>
          Effect.sync(() => {
            if ((caught as Error).name !== "AbortError") error = (caught as Error).message;
          }),
        ),
        Effect.timeoutTo({
          duration: Duration.millis(sampleMs),
          onSuccess: () => undefined,
          onTimeout: () => undefined,
        }),
      );
    }),
  );

  return {
    ok: status >= 200 && status < 300 && !error,
    status,
    bytes,
    durationMs: Math.round(performance.now() - started),
    data: events,
    error,
  };
}

function analyzeSseSurface(events: unknown[]) {
  let snippet: string | null = null;
  let messageId: string | null = null;
  let partId: string | null = null;
  let eventId: string | null = null;
  let timestamp: number | null = null;
  let exposesToolOutput = false;
  let fallbackActivitySnippet: string | null = null;
  let fallbackActivityKind: "thinking" | "compaction" | null = null;
  let fallbackActivityMessageId: string | null = null;
  let fallbackActivityPartId: string | null = null;

  for (const rawEvent of events.toReversed()) {
    if (!rawEvent || typeof rawEvent !== "object") continue;
    const event = rawEvent as {
      id?: unknown;
      type?: unknown;
      properties?: {
        time?: unknown;
        part?: {
          id?: unknown;
          messageID?: unknown;
          type?: unknown;
          text?: unknown;
          state?: { output?: unknown; error?: unknown; content?: unknown[] };
        };
      };
    };
    if (!eventId && typeof event.id === "string") eventId = event.id;
    if (typeof event.properties?.time === "number") timestamp ||= event.properties.time;
    const eventActivity = eventActivitySummary(event.type);
    if (!fallbackActivitySnippet && eventActivity) {
      fallbackActivitySnippet = eventActivity.snippet;
      fallbackActivityKind = eventActivity.kind;
    }
    const part = event.properties?.part;
    if (!part) continue;
    if (!snippet && part.type === "text" && typeof part.text === "string") {
      snippet = compactSnippet(part.text);
      if (snippet) {
        partId = typeof part.id === "string" ? part.id : null;
        messageId = typeof part.messageID === "string" ? part.messageID : null;
      }
    }
    if (part.type === "tool") {
      if (typeof part.state?.output === "string") exposesToolOutput = true;
      if (textFromToolContent(part.state?.content)) exposesToolOutput = true;
      if (typeof part.state?.error === "string") exposesToolOutput = true;
    }
    if (!fallbackActivitySnippet) {
      const activity = activityPartSummary(part);
      if (activity) {
        fallbackActivitySnippet = activity.snippet;
        fallbackActivityKind = activity.kind;
        fallbackActivityPartId = typeof part.id === "string" ? part.id : null;
        fallbackActivityMessageId = typeof part.messageID === "string" ? part.messageID : null;
      }
    }
  }

  if (!snippet && fallbackActivitySnippet) {
    snippet = fallbackActivitySnippet;
    if (!messageId) messageId = fallbackActivityMessageId;
    if (!partId) partId = fallbackActivityPartId;
  }

  return {
    eventCount: events.length,
    eventTypes: [...new Set(events.map((event) => (event as { type?: unknown })?.type))].filter(
      Boolean,
    ),
    humanReadableLatestAssistantSnippet: snippet,
    exposesToolOutput,
    partialLiveUpdates: true,
    identifiers: { eventId, messageId, partId, runId: null as string | null },
    latestActivityTimestamp: timestamp,
    recentItems: snippet
      ? [
          {
            kind: (fallbackActivitySnippet === snippet
              ? (fallbackActivityKind ?? "thinking")
              : "message") as RecentActivityItem["kind"],
            snippet,
            messageId,
            partId,
            timestamp,
            partial: true,
            source: "sse" as const,
          },
        ]
      : [],
  };
}

function openCodeEventSessionId(rawEvent: unknown) {
  if (!rawEvent || typeof rawEvent !== "object") return null;
  const event = rawEvent as {
    properties?: {
      sessionID?: unknown;
      sessionId?: unknown;
      session?: { id?: unknown };
      info?: { sessionID?: unknown; sessionId?: unknown };
      message?: { sessionID?: unknown; sessionId?: unknown };
      part?: { sessionID?: unknown; sessionId?: unknown };
    };
  };
  const candidate =
    event.properties?.sessionID ||
    event.properties?.sessionId ||
    event.properties?.session?.id ||
    event.properties?.info?.sessionID ||
    event.properties?.info?.sessionId ||
    event.properties?.message?.sessionID ||
    event.properties?.message?.sessionId ||
    event.properties?.part?.sessionID ||
    event.properties?.part?.sessionId;
  return typeof candidate === "string" ? candidate : null;
}

export function normalizeOpenCodeSseActivity(sessionId: string, rawEvent: unknown) {
  const eventSessionId = openCodeEventSessionId(rawEvent);
  if (eventSessionId && eventSessionId !== sessionId) return null;
  if (!rawEvent || typeof rawEvent !== "object") return null;

  const event = rawEvent as {
    id?: unknown;
    type?: unknown;
    properties?: { status?: unknown; time?: unknown };
  };
  const type = typeof event.type === "string" ? event.type : "unknown";
  if (!eventSessionId && type !== "server.connected") return null;

  const analyzed = analyzeSseSurface([rawEvent]);
  const rawStatus = event.properties?.status;
  const status = rawOpenCodeActivityStatus(rawStatus);

  return {
    type: "event",
    saySessionId: sessionId,
    checkedAt: Date.now(),
    status: status === "unknown" ? null : status,
    statusRaw: rawStatus ?? null,
    latestOutputSnippet: analyzed.humanReadableLatestAssistantSnippet,
    latestActivityTimestamp: analyzed.latestActivityTimestamp || Date.now(),
    previewSource: "sse",
    identifiers: analyzed.identifiers,
    eventType: type,
    recentItems: ensureRecentItemsWithHtml({
      recentItems: analyzed.recentItems,
      latestOutputSnippet: analyzed.humanReadableLatestAssistantSnippet,
      messageId: analyzed.identifiers.messageId,
      partId: analyzed.identifiers.partId,
      timestamp: analyzed.latestActivityTimestamp || Date.now(),
      partial: true,
      source: "sse",
    }),
    partialLiveUpdates: true,
    notes: analyzed.humanReadableLatestAssistantSnippet
      ? []
      : [`OpenCode event ${type} did not include text output.`],
  };
}

export function writeSse(client: SseClient, payload: unknown, eventName?: string) {
  writeSseEvent(client, payload, eventName);
}

export async function compareOpenCodeSurfaces(sessionId: string, limit: number, sampleMs: number) {
  const directory = (await getOpenCodeSessionInfo(sessionId))?.directory || opencodeDirectory;
  const v2Url = debugOpenCodeUrl(`/api/session/${sessionId}/message`);
  v2Url.searchParams.set("directory", directory);
  v2Url.searchParams.set("limit", String(limit));
  v2Url.searchParams.set("order", "desc");
  const legacyUrl = debugOpenCodeUrl(`/session/${sessionId}/message`);
  legacyUrl.searchParams.set("directory", directory);
  legacyUrl.searchParams.set("limit", String(Math.min(limit, 3)));
  const sseUrl = debugOpenCodeUrl("/event");
  sseUrl.searchParams.set("directory", directory);

  const [v2Response, legacyResponse, sseResponse] = await Promise.all([
    fetchOpenCodeDebugJson(v2Url),
    fetchOpenCodeDebugJson(legacyUrl),
    fetchOpenCodeSseSample(sseUrl, sampleMs),
  ]);

  const v2Analysis = analyzeV2MessageSurface(v2Response.data);
  const legacyAnalysis = analyzeLegacyMessageSurface(legacyResponse.data);
  const sseAnalysis = Array.isArray(sseResponse.data) ? analyzeSseSurface(sseResponse.data) : null;

  return {
    saySessionId: sessionId,
    linkedOpenCodeSessionId:
      validateSessionId(sessionId) && sessionId !== "default" ? sessionId : null,
    checkedAt: Date.now(),
    surfaces: {
      v2SessionMessages: {
        endpoint: "/api/session/:sessionID/message?directory=<dir>&limit=<n>&order=desc",
        sdkCall: "client.v2.session.messages({ sessionID, directory, limit, order: 'desc' })",
        samplePayloadBytes: v2Response.bytes,
        latencyMs: v2Response.durationMs,
        ok: v2Response.ok,
        error: v2Response.error,
        ...v2Analysis,
        failureReconnectBehavior: "Plain HTTP poll; caller retries on non-2xx or network failure.",
      },
      legacySessionMessages: {
        endpoint: "/session/:sessionID/message?directory=<dir>&limit=<n>",
        sdkCall: "client.session.messages({ sessionID, directory, limit })",
        samplePayloadBytes: legacyResponse.bytes,
        latencyMs: legacyResponse.durationMs,
        ok: legacyResponse.ok,
        error: legacyResponse.error,
        ...legacyAnalysis,
        failureReconnectBehavior: "Plain HTTP poll; caller retries on non-2xx or network failure.",
      },
      eventStream: {
        endpoint: "/event?directory=<dir>",
        sdkCall: "client.event.subscribe({ directory })",
        samplePayloadBytes: sseResponse.bytes,
        samplingTimeMs: sseResponse.durationMs,
        ok: sseResponse.ok,
        error: sseResponse.error,
        ...(sseAnalysis || analyzeSseSurface([])),
        failureReconnectBehavior:
          "Browser EventSource reconnects automatically; a server-side bridge must explicitly reconnect and replay state from polling.",
      },
    },
    recommendation: {
      initialStaticPreview:
        "Use legacy session messages for now: it returned assistant text/tool parts on this session, while v2 returned only session timeline events.",
      liveUpdates:
        "Use the /event SSE stream for partial message.part.updated events, backed by periodic legacy-message polling for reconnect/catch-up.",
      nextDebugResponseShouldInclude:
        "latest assistant text snippet, fallback tool output snippet, message id, part id, event id when applicable, timestamp, generation flag, payload bytes, latency, and stale/error notes.",
    },
  };
}

export async function openCodeEventUrl(sessionId: string): Promise<URL> {
  const directory = (await getOpenCodeSessionInfo(sessionId))?.directory || opencodeDirectory;
  const url = debugOpenCodeUrl("/event");
  url.searchParams.set("directory", directory);
  return url;
}
