import { describe, expect, it } from "vite-plus/test";
import {
  registerPaseoChatListenerStarter,
  registerPaseoChatListenerStopper,
  startPaseoChatListener,
  stopPaseoChatListener,
} from "./chat-listener-lifecycle.ts";

describe("Paseo chat listener lifecycle bridge", () => {
  it("delegates start and stop requests to the registered listener", () => {
    const calls: string[] = [];
    registerPaseoChatListenerStarter((sessionId) => calls.push(`start:${sessionId}`));
    registerPaseoChatListenerStopper((sessionId) => calls.push(`stop:${sessionId}`));

    startPaseoChatListener("pc_room");
    stopPaseoChatListener("pc_room");

    expect(calls).toEqual(["start:pc_room", "stop:pc_room"]);
  });
});
