import { afterAll } from "vite-plus/test";
import { teardownApi } from "./api.harness.ts";

import "./api.jarvis-status.suite.ts";
import "./api.routines.suite.ts";
import "./api.completion-watch.suite.ts";

afterAll(async () => {
  await teardownApi();
});
