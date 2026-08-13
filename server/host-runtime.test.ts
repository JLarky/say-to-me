import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  ensureHostRuntimeStarted,
  ensureHostRuntimeStartedWithOptions,
  hostRuntimeResumeCountForTest,
  hostRuntimeStartedCountForTest,
  stopHostRuntime,
} from "./host-runtime.ts";

describe("host runtime", () => {
  afterAll(async () => {
    await stopHostRuntime();
  });

  it("starts only once across repeated ensure calls", async () => {
    await stopHostRuntime();
    const before = hostRuntimeStartedCountForTest();

    ensureHostRuntimeStarted();
    ensureHostRuntimeStarted();

    expect(hostRuntimeStartedCountForTest()).toBe(before + 1);
  });

  it("can explicitly resume startup work for fresh API middleware lifecycles", async () => {
    await stopHostRuntime();
    const beforeStarts = hostRuntimeStartedCountForTest();
    const beforeResumes = hostRuntimeResumeCountForTest();

    ensureHostRuntimeStarted();
    ensureHostRuntimeStartedWithOptions({ resume: true });
    ensureHostRuntimeStartedWithOptions({ resume: true });

    expect(hostRuntimeStartedCountForTest()).toBeGreaterThanOrEqual(beforeStarts);
    expect(hostRuntimeStartedCountForTest()).toBeLessThanOrEqual(beforeStarts + 1);
    expect(hostRuntimeResumeCountForTest()).toBe(beforeResumes + 2);
  });
});
