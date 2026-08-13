#!/usr/bin/env -S node --no-warnings
import YAML from "yaml";
import { workflow } from "@jlarky/gha-ts/workflow-types";
import { checkout } from "@jlarky/gha-ts/actions";
import { generateWorkflow } from "@jlarky/gha-ts/cli";

const wf = workflow({
  name: "CI",
  on: {
    push: { branches: ["main"] },
    pull_request: {},
  },
  jobs: {
    ci: {
      "runs-on": "ubuntu-latest",
      steps: [
        checkout(),
        {
          uses: "voidzero-dev/setup-vp@v1",
          with: { "node-version": "24", cache: true },
        },
        { run: "vp install" },
        {
          name: "Check generated workflows are in sync",
          run: 'for f in .github/workflows/*.main.ts; do node "$f"; done\ngit diff --exit-code .github/workflows/',
        },
        { run: "vp check" },
        // Bare `vp test` always executes the full Vitest graph (no task cache).
        // Locally prefer `vp run test` / `vp run check` for per-project replay.
        { run: "vp test" },
      ],
    },
  },
});

await generateWorkflow(wf, YAML.stringify, import.meta.url);
