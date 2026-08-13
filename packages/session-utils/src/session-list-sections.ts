export type SessionListItem = {
  state?: string | null;
};

export type SessionListSections<T extends SessionListItem> = {
  jarvis: T[];
  important: T[];
  general: T[];
  archived: T[];
};

/** Partition homepage session rows into Jarvis → Important → General → Archived. */
export function sessionListSections<T extends SessionListItem>(
  sessions: readonly T[],
): SessionListSections<T> {
  return {
    jarvis: sessions.filter((session) => session.state === "jarvis"),
    important: sessions.filter((session) => session.state === "important"),
    general: sessions.filter((session) => (session.state ?? "general") === "general"),
    archived: sessions.filter((session) => session.state === "archived"),
  };
}
