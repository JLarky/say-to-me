import * as OpenApi from "@effect/platform/OpenApi";

export function openApiDocs(summary: string, description: string) {
  return OpenApi.annotations({ summary, description });
}
