import { afterAll } from "vite-plus/test";
import { teardownApi } from "./api.harness.ts";

import "./api.messages.suite.ts";
import "./api.messages-core.suite.ts";
import "./api.messages-fields.suite.ts";
import "./api.messages-forward.suite.ts";
import "./api.messages-forward-completion.suite.ts";
import "./api.routines-session-idle.suite.ts";

afterAll(async () => {
  await teardownApi();
});
