import { describe, expect, it } from "vite-plus/test";
import { openCodeMessageInfoError } from "./message-error.ts";

describe("openCodeMessageInfoError", () => {
  it("returns data.message for UnknownError", () => {
    expect(
      openCodeMessageInfoError({
        id: "msg_failed",
        role: "assistant",
        error: {
          name: "UnknownError",
          data: { message: "AWS credential provider failed: Token is expired." },
        },
      }),
    ).toBe("AWS credential provider failed: Token is expired.");
  });

  it("ignores MessageAbortedError from user stop", () => {
    expect(
      openCodeMessageInfoError({
        id: "msg_aborted",
        role: "assistant",
        error: {
          name: "MessageAbortedError",
          data: { message: "The operation was aborted." },
        },
      }),
    ).toBeNull();
  });

  it("ignores non-assistant info", () => {
    expect(
      openCodeMessageInfoError({
        id: "msg_user",
        role: "user",
        error: {
          name: "UnknownError",
          data: { message: "should not surface" },
        },
      }),
    ).toBeNull();
  });
});
