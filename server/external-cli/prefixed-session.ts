const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PrefixedUuidSession = {
  readonly prefix: string;
  readonly idPattern: RegExp;
};

export function prefixedUuidSessionId(
  { prefix, idPattern }: PrefixedUuidSession,
  input: string,
): string | null {
  if (idPattern.test(input)) return input;
  if (UUID.test(input)) return `${prefix}${input}`;
  return null;
}

export function stripPrefixedUuid(prefix: string, sessionId: string): string {
  return sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : sessionId;
}

export function isPrefixedUuidSessionId(
  { idPattern }: PrefixedUuidSession,
  sessionId: string,
): boolean {
  return idPattern.test(sessionId);
}
