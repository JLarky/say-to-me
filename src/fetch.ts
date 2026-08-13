import "../server/tracing.ts";
import type { Fetchable } from "astro";
import { Elysia } from "elysia";
import { FetchState, astro } from "astro/fetch";
import { handleWebHostRequest } from "../server/web-host.ts";

const app = new Elysia().all("*", async ({ request }) => {
  const apiResponse = await handleWebHostRequest(request);
  if (apiResponse) return apiResponse;
  return astro(new FetchState(request));
});

export default {
  fetch(request: Request) {
    return app.fetch(request);
  },
} satisfies Fetchable;
