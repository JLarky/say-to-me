/** Pure display helpers for quick-search rows (unit-tested). */

export function shortenSessionId(id: string, max = 28): string {
  if (id.length <= max) return id;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function excerptText(text: string, max = 72): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function isIdMatchReason(reason: string): boolean {
  return reason === "exact-id" || reason === "id-prefix";
}

export function highlightMatch(text: string, query: string): Array<string | { match: string }> {
  const q = query.trim();
  if (!q || !text) return [text];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const index = lower.indexOf(needle);
  if (index < 0) return [text];
  const before = text.slice(0, index);
  const match = text.slice(index, index + q.length);
  const after = text.slice(index + q.length);
  const parts: Array<string | { match: string }> = [];
  if (before) parts.push(before);
  parts.push({ match });
  if (after) parts.push(after);
  return parts;
}

export function sessionSecondaryLine(input: { id: string; ownerSpaceName: string | null }): string {
  const parts = [shortenSessionId(input.id)];
  if (input.ownerSpaceName?.trim()) parts.push(input.ownerSpaceName.trim());
  return parts.join(" · ");
}

export function spaceSecondaryLine(input: { context: string; id: string }): string {
  const excerpt = excerptText(input.context);
  return excerpt || "Space";
}
