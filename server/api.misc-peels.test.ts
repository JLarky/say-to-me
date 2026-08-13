import { afterAll } from "vite-plus/test";
import { teardownApi } from "./api.harness.ts";

import "./api.otel.suite.ts";
import "./api.notes.suite.ts";
import "./api.jinx.suite.ts";

afterAll(async () => {
  await teardownApi();
});
