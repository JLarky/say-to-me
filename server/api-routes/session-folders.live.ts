import { Effect, Layer } from "effect";
import { getOrganization, saveOrganization } from "../session-folders.ts";
import { SessionOrganization, type SessionOrganizationService } from "./session-folders.ts";

export const SessionOrganizationLive = Layer.succeed(SessionOrganization, {
  get: () => Effect.sync(() => getOrganization()),
  save: (input) => Effect.sync(() => saveOrganization(input)),
} satisfies SessionOrganizationService);
