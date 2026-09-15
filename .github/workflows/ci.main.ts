#!/usr/bin/env -S node --no-warnings
import YAML from "yaml";
import { workflow } from "@jlarky/gha-ts/workflow-types";
import { checkout, setupBun, setupNode } from "@jlarky/gha-ts/actions";
import { generateWorkflow } from "@jlarky/gha-ts/cli";

const wf = workflow({
  name: "CI",
  on: {
    push: { branches: ["new"] },
    pull_request: { branches: ["new"] },
  },
  jobs: {
    ci: {
      "runs-on": "ubuntu-latest",
      steps: [
        checkout(),
        {
          uses: "pnpm/action-setup@v4",
          with: { version: "10" },
        },
        setupNode({ "node-version": "24", cache: "pnpm" }),
        setupBun(),
        { run: "pnpm install --frozen-lockfile" },
        {
          name: "Check generated workflows are in sync",
          run: 'for f in .github/workflows/*.main.ts; do node "$f"; done\ngit diff --exit-code .github/workflows/',
        },
        { run: "pnpm lint" },
        { run: "pnpm typecheck" },
        { run: "pnpm test" },
        { run: "pnpm test:bun" },
      ],
    },
  },
});

await generateWorkflow(wf, YAML.stringify, import.meta.url);
