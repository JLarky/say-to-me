import { afterAll } from "vite-plus/test";
import { teardownApi } from "./api.harness.ts";

import "./api.opencode.suite.ts";
import "./api.opencode-defer.suite.ts";
import "./api.opencode-activity-preview.suite.ts";
import "./api.opencode-session-creation.suite.ts";
import "./api.opencode-workspace-routes.suite.ts";
import "./api.opencode-context-import.suite.ts";
import "./api.opencode-delivery-status.suite.ts";

afterAll(async () => {
  await teardownApi();
});
