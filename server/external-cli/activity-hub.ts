import { existsSync, readFileSync } from "node:fs";
import { createActivityHub, type ActivityListener } from "../activityHub.ts";
import { withExternalCliItemHtml } from "../markdown/extra-markdown-html.ts";
import { detectSessionBackend } from "../session-id.ts";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Provider transcript parsers retain provider-specific item fields before rendering.
export type ExternalCliActivityItem = { readonly timestamp?: number | null } & Record<
  string,
  unknown
>;

export type ExternalCliActivitySnapshot<TItem extends ExternalCliActivityItem> = {
  readonly items: TItem[];
  readonly lastTimestamp: number | null;
  readonly busy: boolean;
  readonly status: "busy" | "idle";
};

export const EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT = 5;
export const EXTERNAL_CLI_ACTIVITY_MAX_LIMIT = 50;

export function parseExternalCliActivityLimit(raw: string | undefined): number {
  const value = Number(raw ?? EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT);
  if (!Number.isInteger(value) || value < 1) return EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT;
  return Math.min(value, EXTERNAL_CLI_ACTIVITY_MAX_LIMIT);
}

export function limitExternalCliActivitySnapshot<TItem extends ExternalCliActivityItem>(
  snapshot: ExternalCliActivitySnapshot<TItem>,
  limit: number,
): ExternalCliActivitySnapshot<TItem & { html: string }> {
  return {
    ...snapshot,
    items: withExternalCliItemHtml(
      snapshot.items.slice(-limit) as Array<TItem & { kind?: unknown; text?: unknown }>,
    ),
  };
}

export type ExternalCliActivityHubConfig<TItem extends ExternalCliActivityItem> = {
  backendLabel: string;
  isSessionBusy: (sessionId: string) => boolean;
  getSessionFilePath: (sessionId: string) => string | null;
  parseActivity: (
    content: string,
    maxLimit: number,
  ) => { items: TItem[]; lastTimestamp: number | null };
};

export type ExternalCliActivityHub<TItem extends ExternalCliActivityItem> = {
  shutdown: () => void;
  getSnapshot: (sessionId: string, limit?: number) => Promise<ExternalCliActivitySnapshot<TItem>>;
  subscribe: (
    sessionId: string,
    limit: number,
    listener: ActivityListener<ExternalCliActivitySnapshot<TItem>>,
  ) => () => void;
};

export function createExternalCliActivityHub<TItem extends ExternalCliActivityItem>(
  config: ExternalCliActivityHubConfig<TItem>,
): ExternalCliActivityHub<TItem> {
  const { backendLabel, isSessionBusy, getSessionFilePath, parseActivity } = config;

  const EMPTY: Pick<ExternalCliActivitySnapshot<TItem>, "items" | "lastTimestamp"> = {
    items: [],
    lastTimestamp: null,
  };

  async function fetchActivitySnapshot(
    sessionId: string,
  ): Promise<ExternalCliActivitySnapshot<TItem>> {
    if (detectSessionBackend(sessionId) !== backendLabel) {
      throw new Error(`Not a ${backendLabel} session.`);
    }
    const busy = isSessionBusy(sessionId);
    const filePath = getSessionFilePath(sessionId);
    if (!filePath) return { ...EMPTY, busy, status: busy ? "busy" : "idle" };

    const content = existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
    if (content === null) return { ...EMPTY, busy, status: busy ? "busy" : "idle" };

    return {
      ...parseActivity(content, EXTERNAL_CLI_ACTIVITY_MAX_LIMIT),
      busy,
      status: busy ? "busy" : "idle",
    };
  }

  const activityHub = createActivityHub<ExternalCliActivitySnapshot<TItem>>({
    fetchSnapshot: fetchActivitySnapshot,
    pollIntervalMs: 2500,
    isActiveSnapshot: (snapshot) => snapshot.status === "busy",
  });

  return {
    shutdown: () => activityHub.shutdown(),

    async getSnapshot(sessionId: string, limit = EXTERNAL_CLI_ACTIVITY_DEFAULT_LIMIT) {
      const snapshot = await activityHub.snapshot(sessionId);
      return limitExternalCliActivitySnapshot(snapshot, limit);
    },

    subscribe(
      sessionId: string,
      limit: number,
      listener: ActivityListener<ExternalCliActivitySnapshot<TItem>>,
    ): () => void {
      const limitedListener: ActivityListener<ExternalCliActivitySnapshot<TItem>> = {
        onSnapshot: (snapshot) =>
          listener.onSnapshot(limitExternalCliActivitySnapshot(snapshot, limit)),
        onError: listener.onError,
      };
      const unsubscribe = activityHub.subscribe(sessionId, limitedListener);
      void activityHub.snapshot(sessionId).then(limitedListener.onSnapshot, (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        limitedListener.onError(message);
      });
      return unsubscribe;
    },
  };
}
