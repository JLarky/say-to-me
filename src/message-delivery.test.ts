import { describe, expect, it } from "vite-plus/test";

import {
  canForceSendDelivery,
  canRetryDelivery,
  deliveryProviderLabel,
  deliveryStatusLabel,
  idleNotificationSessionId,
  systemMessageText,
} from "./message-delivery.ts";
import type { Message } from "./types.ts";

function message(overrides: Partial<Message>): Message {
  return {
    id: 1,
    text: "hi",
    status: "queued",
    author: "agent",
    sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
    ...overrides,
  };
}

describe("message-delivery", () => {
  it("labels delivery providers from session id prefixes", () => {
    expect(deliveryProviderLabel(message({ sessionId: "cur_1" }))).toBe("Cursor");
    expect(deliveryProviderLabel(message({ sessionId: "cc_1" }))).toBe("Claude");
    expect(deliveryProviderLabel(message({ sessionId: "cx_1" }))).toBe("Codex");
    expect(deliveryProviderLabel(message({ sessionId: "gr_1" }))).toBe("Grok");
    expect(deliveryProviderLabel(message({ sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6" }))).toBe(
      "OpenCode",
    );
    expect(() => deliveryProviderLabel(message({ sessionId: "t3_1" }))).toThrow(
      /session id "t3_1".*no known delivery provider/,
    );
  });

  it("labels from the forward target when present", () => {
    expect(
      deliveryProviderLabel(
        message({
          sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
          forwardTargetSessionId: "gr_1",
        }),
      ),
    ).toBe("Grok");
  });

  it("offers retry for every delivery-backed provider, resolved from the target session", () => {
    expect(canRetryDelivery(message({ sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6" }))).toBe(true);
    expect(canRetryDelivery(message({ sessionId: "gr_1" }))).toBe(true);
    expect(canRetryDelivery(message({ sessionId: "cur_1" }))).toBe(true);
    expect(canRetryDelivery(message({ sessionId: "cc_1" }))).toBe(true);
    expect(canRetryDelivery(message({ sessionId: "cx_1" }))).toBe(true);
    expect(canRetryDelivery(message({ sessionId: "t3_1" }))).toBe(false);
    expect(
      canRetryDelivery(
        message({
          sessionId: "t3_1",
          forwardTargetSessionId: "gr_1",
        }),
      ),
    ).toBe(true);
    expect(
      canRetryDelivery(
        message({
          sessionId: "gr_1",
          forwardTargetSessionId: "t3_1",
        }),
      ),
    ).toBe(false);
  });

  it("offers force send only for ses_ targets, never via label fallthrough", () => {
    expect(canForceSendDelivery(message({ sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6" }))).toBe(
      true,
    );
    expect(canForceSendDelivery(message({ sessionId: "gr_1" }))).toBe(false);
    expect(canForceSendDelivery(message({ sessionId: "cur_1" }))).toBe(false);
    expect(canForceSendDelivery(message({ sessionId: "t3_1" }))).toBe(false);
    expect(
      canForceSendDelivery(
        message({
          sessionId: "gr_1",
          forwardTargetSessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
        }),
      ),
    ).toBe(true);
    expect(
      canForceSendDelivery(
        message({
          sessionId: "ses_82c41693cb14xpTRmGfTDe4Qs6",
          forwardTargetSessionId: "gr_1",
        }),
      ),
    ).toBe(false);
  });

  it("formats known delivery statuses", () => {
    expect(deliveryStatusLabel("queued", "OpenCode")).toBe("Waiting for OpenCode to be idle");
    expect(deliveryStatusLabel("cli_timed_out", "Cursor")).toBe("Cursor CLI timed out");
  });

  it("parses idle notification and system message text", () => {
    expect(
      idleNotificationSessionId(
        message({
          text: "<say-to-me-system>ses_09a0fc08523fctVzW8czyW9yAN is idle now</say-to-me-system>",
        }),
      ),
    ).toBe("ses_09a0fc08523fctVzW8czyW9yAN");
    expect(systemMessageText("<say-to-me-system>hello</say-to-me-system>")).toBe("hello");
    expect(systemMessageText("plain")).toBeNull();
  });
});
