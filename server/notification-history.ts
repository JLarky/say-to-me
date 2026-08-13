import { desc, eq, inArray } from "drizzle-orm";
import { notifications } from "./db/drizzle-schema.ts";
import { drizzleDb, drizzleSqlite } from "./db/index.ts";
import { DbNotification, validateDb } from "./db/schemas.ts";
import { getCachedProviderTitle } from "./session-enrich.ts";
import { getSession } from "./sessions.ts";
import { resolveListDisplayName } from "../src/session-display.ts";
import { formatSseEvent, type SseClient } from "./sse/client.ts";

const maxStoredNotifications = 30;
export { maxStoredNotifications };
let notificationSchemaReady = false;
const notificationClients = new Set<SseClient>();

export function recordNotification(input: {
  body: string;
  sessionId: string;
  title: string;
  url: string;
}) {
  ensureNotificationSchema();
  drizzleDb
    .insert(notifications)
    .values({ ...input, sessionTitle: notificationSessionTitle(input.sessionId) })
    .run();
  pruneNotifications();
  broadcastNotifications();
}

export function dismissNotification(id: number) {
  ensureNotificationSchema();
  const result = drizzleDb
    .update(notifications)
    .set({ dismissedAt: new Date().toISOString() })
    .where(eq(notifications.id, id))
    .run();
  if (result.changes > 0) broadcastNotifications();
  return result.changes > 0;
}

export function listNotifications() {
  ensureNotificationSchema();
  const seen = new Set<string>();
  const latestBySession = [];

  for (const notification of drizzleDb
    .select()
    .from(notifications)
    .orderBy(desc(notifications.id))
    .all()
    .map((row) => validateDb(DbNotification, row, "notification"))) {
    if (seen.has(notification.sessionId)) continue;
    seen.add(notification.sessionId);
    if (notification.dismissedAt) continue;
    latestBySession.push(notification);
    if (latestBySession.length >= maxStoredNotifications) break;
  }

  return latestBySession;
}

export function notificationPayload() {
  return { notifications: listNotifications() };
}

export function addNotificationClient(client: SseClient): void {
  notificationClients.add(client);
  writeNotificationSnapshot(client);
}

export function removeNotificationClient(client: SseClient): void {
  notificationClients.delete(client);
}

function writeNotificationSnapshot(client: SseClient): void {
  void client.write(formatSseEvent(notificationPayload(), "snapshot"));
}

function broadcastNotifications(): void {
  for (const client of notificationClients) {
    try {
      writeNotificationSnapshot(client);
    } catch (error) {
      console.warn("[notifications] removing failed SSE client", {
        error: error instanceof Error ? error.message : String(error),
      });
      notificationClients.delete(client);
    }
  }
}

function ensureNotificationSchema() {
  if (notificationSchemaReady) return;
  const columns = drizzleSqlite.prepare("PRAGMA table_info(notifications)").all();
  const hasSessionTitle = columns.some(
    (column) =>
      column && typeof column === "object" && "name" in column && column.name === "session_title",
  );
  if (!hasSessionTitle) {
    addNotificationColumn(
      "ALTER TABLE notifications ADD COLUMN session_title text NOT NULL DEFAULT ''",
    );
  }
  drizzleSqlite
    .prepare("UPDATE notifications SET session_title = session_id WHERE session_title = ''")
    .run();
  notificationSchemaReady = true;
}

function addNotificationColumn(statement: string) {
  try {
    drizzleSqlite.exec(statement);
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate column name")) return;
    throw error;
  }
}

function notificationSessionTitle(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) return sessionId;
  return resolveListDisplayName({
    id: session.id,
    alias: session.alias,
    opencodeTitle: getCachedProviderTitle(sessionId),
    cwd: session.cwd,
  });
}

function pruneNotifications() {
  const stale = drizzleDb
    .select({ id: notifications.id })
    .from(notifications)
    .orderBy(desc(notifications.id))
    .limit(Number.MAX_SAFE_INTEGER)
    .offset(maxStoredNotifications)
    .all();

  if (stale.length === 0) return;
  drizzleDb
    .delete(notifications)
    .where(
      inArray(
        notifications.id,
        stale.map((row) => row.id),
      ),
    )
    .run();
}
