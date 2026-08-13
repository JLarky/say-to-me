import { defineConfig } from "vite-plus";

/**
 * Per-package `vp run test` task: runs only this package's tests under the root
 * Vitest `packages` project. Excludes Vitest/Vite temp writes so the task can
 * cache (those files are read+written every run and would otherwise disable cache).
 */
export function packageTestConfig(packageDirName: string) {
  return defineConfig({
    run: {
      tasks: {
        test: {
          command: `cd ../.. && vp test --project packages packages/${packageDirName}`,
          input: [
            { auto: true },
            { pattern: "!node_modules/.vite/**", base: "workspace" },
            { pattern: "!node_modules/.vite-temp/**", base: "workspace" },
          ],
        },
      },
    },
  });
}
