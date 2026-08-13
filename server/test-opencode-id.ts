import { createHash } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Deterministic OpenCode-shaped session id for tests.
 * Matches production `OPENCODE_ID`: `ses_` + 12 lowercase hex + 14 base62.
 */
export function testOpenCodeSessionId(label: string): string {
  const digest = createHash("sha256").update(`say-to-me-test:${label}`).digest();
  const hex = Buffer.from(digest.subarray(0, 6)).toString("hex");
  let suffix = "";
  for (let i = 0; i < 14; i++) {
    suffix += BASE62[digest[6 + i]! % 62];
  }
  return `ses_${hex}${suffix}`;
}
