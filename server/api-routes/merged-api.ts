import * as HttpApi from "@effect/platform/HttpApi";
import * as HttpApiBuilder from "@effect/platform/HttpApiBuilder";
import * as HttpServer from "@effect/platform/HttpServer";
import * as OpenApi from "@effect/platform/OpenApi";
import { Layer } from "effect";
import { buildDevSessionsHandlers, DevSessionsGroup } from "./dev-sessions.ts";
import { buildHealthHandlers, HealthGroup, HealthLive } from "./health.ts";
import { buildJarvisSessionsHandlers, JarvisSessionsGroup } from "./jarvis-sessions.ts";
import { buildJarvisStatusHandlers, JarvisStatusGroup } from "./jarvis-status.ts";
import { JarvisStatusOpenCodeLive } from "../jarvis-status.ts";
import { buildJarvisTimersHandlers, JarvisTimersGroup } from "./jarvis-timers.ts";
import { JarvisTimerLive } from "../timers.ts";
import {
  buildMessageControlsHandlers,
  MessageControlLive,
  MessageControlsGroup,
} from "./message-controls.ts";
import {
  buildMessageCreateHandlers,
  MessageCreateGroup,
  MessageCreateLive,
} from "./message-create.ts";
import { buildNotesHandlers, NotesGroup, NotesLive } from "./notes.ts";
import {
  buildNotificationsHandlers,
  NotificationsGroup,
  NotificationsLive,
} from "./notifications.ts";
import {
  buildOpenCodeActivityPreviewHandlers,
  OpenCodeActivityPreviewGroup,
} from "./opencode-activity-preview.ts";
import {
  buildOpenCodeCompactHandlers,
  CompactOpenCodeLive,
  OpenCodeCompactGroup,
} from "./opencode-compact.ts";
import {
  buildOpenCodeModelControlsHandlers,
  OpenCodeModelControlsGroup,
  OpenCodeModelControlsLive,
  OpenCodeModelSessionLive,
} from "./opencode-model-controls.ts";
import {
  buildOpenCodeSessionsHandlers,
  OpenCodeSessionsGroup,
  OpenCodeSessionsLive,
} from "./opencode-sessions.ts";
import { buildClaudeStopHandlers, ClaudeStopGroup, StopClaudeLive } from "./claude-stop.ts";
import { buildCodexStopHandlers, CodexStopGroup, StopCodexLive } from "./codex-stop.ts";
import { buildCursorStopHandlers, CursorStopGroup, StopCursorLive } from "./cursor-stop.ts";
import { buildGrokStopHandlers, GrokStopGroup, StopGrokLive } from "./grok/grok-stop.ts";
import { buildOpenCodeStopHandlers, OpenCodeStopGroup, StopOpenCodeLive } from "./opencode-stop.ts";
import {
  buildOpenCodeWorkspacesHandlers,
  OpenCodeWorkspaceLive,
  OpenCodeWorkspacesGroup,
} from "./opencode-workspaces.ts";
import { PushLive } from "./push.live.ts";
import { buildPushHandlers, PushGroup } from "./push.ts";
import { buildUserMessagesPollHandlers, UserMessagesPollGroup } from "./user-messages-poll.ts";
import { buildClaudeActivityHandlers, ClaudeActivityGroup } from "./claude-activity.ts";
import { buildCodexActivityHandlers, CodexActivityGroup } from "./codex-activity.ts";
import {
  buildExternalCliDiscoverHandlers,
  ExternalCliDiscoverGroup,
} from "./external-cli-discover.ts";
import {
  buildExternalCliResolveHandlers,
  ExternalCliResolveGroup,
} from "./external-cli-resolve.ts";
import { buildCursorActivityHandlers, CursorActivityGroup } from "./cursor-activity.ts";
import { buildGrokActivityHandlers, GrokActivityGroup } from "./grok/grok-activity.ts";
import { buildQueueHandlers, QueueGroup } from "./queue.ts";
import { SessionOrganizationLive } from "./session-folders.live.ts";
import { buildSessionFoldersHandlers, SessionFoldersGroup } from "./session-folders.ts";
import { buildSessionsHandlers, SessionMutationsLive, SessionsGroup } from "./sessions.ts";
import { buildWaitingStateHandlers, WaitingStateGroup } from "./waiting-state.ts";
import { buildSearchHandlers, SearchGroup } from "./search.ts";
import { buildQuickSearchHandlers, QuickSearchGroup } from "./quick-search.ts";
import { buildCurrentModelHandlers, CurrentModelGroup } from "./current-session-model.ts";
import { buildProviderModelsHandlers, ProviderModelsGroup } from "./provider-models.ts";
import { ProviderModelsLive } from "@say-to-me/provider-models";
import {
  buildSessionModelsHandlers,
  SessionModelsGroup,
  SessionModelSessionLive,
} from "./session-models.ts";
import {
  buildSessionReasoningEffortHandlers,
  SessionReasoningEffortGroup,
  SessionReasoningEffortServiceLive,
} from "./session-reasoning-effort.ts";
import {
  buildSessionOpenCodeReasoningEffortHandlers,
  SessionOpenCodeReasoningEffortGroup,
  SessionOpenCodeReasoningEffortServiceLive,
} from "./session-opencode-reasoning-effort.ts";
import { buildCliSessionsHandlers, CliSessionsGroup } from "./cli-sessions.ts";
import { buildSessionContextHandlers, SessionContextGroup } from "./session-context.ts";
import { buildWorkspacePathHandlers, WorkspacePathGroup } from "./workspace-path.ts";
import { buildSpacesHandlers, SpacesGroup } from "./spaces.ts";
import { buildSettingsHandlers, SettingsGroup } from "./settings.ts";
import { buildT3DiscoverHandlers, T3DiscoverGroup } from "./t3-discover.ts";
import { buildPaseoDiscoverHandlers, PaseoDiscoverGroup } from "./paseo-discover.ts";
import { buildPaseoStopHandlers, PaseoStopGroup, StopPaseoLive } from "./paseo-stop.ts";

export const SayToMeApi = HttpApi.make("say-to-me")
  .annotateContext(
    OpenApi.annotations({
      title: "Say To Me",
      version: "0.1.0",
      description:
        "Host-neutral HTTP API for Say To Me sessions, messages, providers, and Jarvis tooling.",
    }),
  )
  .add(HealthGroup)
  .add(WorkspacePathGroup)
  .add(SpacesGroup)
  .add(SettingsGroup)
  .add(T3DiscoverGroup)
  .add(PaseoDiscoverGroup)
  .add(PaseoStopGroup)
  .add(SessionsGroup)
  .add(JarvisStatusGroup)
  .add(QueueGroup)
  .add(MessageCreateGroup)
  .add(WaitingStateGroup)
  .add(JarvisSessionsGroup)
  .add(JarvisTimersGroup)
  .add(OpenCodeSessionsGroup)
  .add(OpenCodeWorkspacesGroup)
  .add(OpenCodeStopGroup)
  .add(CursorStopGroup)
  .add(ClaudeStopGroup)
  .add(CodexStopGroup)
  .add(GrokStopGroup)
  .add(OpenCodeCompactGroup)
  .add(OpenCodeModelControlsGroup)
  .add(NotificationsGroup)
  .add(PushGroup)
  .add(UserMessagesPollGroup)
  .add(ClaudeActivityGroup)
  .add(CursorActivityGroup)
  .add(CodexActivityGroup)
  .add(GrokActivityGroup)
  .add(ExternalCliResolveGroup)
  .add(ExternalCliDiscoverGroup)
  .add(SessionContextGroup)
  .add(CliSessionsGroup)
  .add(NotesGroup)
  .add(MessageControlsGroup)
  .add(DevSessionsGroup)
  .add(OpenCodeActivityPreviewGroup)
  .add(SessionFoldersGroup)
  .add(SearchGroup)
  .add(QuickSearchGroup)
  .add(ProviderModelsGroup)
  .add(SessionModelsGroup)
  .add(CurrentModelGroup)
  .add(SessionReasoningEffortGroup)
  .add(SessionOpenCodeReasoningEffortGroup);

const SayToMeHandlers = Layer.mergeAll(
  buildHealthHandlers(SayToMeApi),
  buildWorkspacePathHandlers(SayToMeApi),
  buildSpacesHandlers(SayToMeApi),
  buildSettingsHandlers(SayToMeApi),
  buildT3DiscoverHandlers(SayToMeApi),
  buildPaseoDiscoverHandlers(SayToMeApi),
  buildPaseoStopHandlers(SayToMeApi),
  buildSessionsHandlers(SayToMeApi),
  buildJarvisStatusHandlers(SayToMeApi),
  buildQueueHandlers(SayToMeApi),
  buildMessageCreateHandlers(SayToMeApi),
  buildWaitingStateHandlers(SayToMeApi),
  buildJarvisSessionsHandlers(SayToMeApi),
  buildJarvisTimersHandlers(SayToMeApi),
  buildOpenCodeSessionsHandlers(SayToMeApi),
  buildOpenCodeWorkspacesHandlers(SayToMeApi),
  buildOpenCodeStopHandlers(SayToMeApi),
  buildCursorStopHandlers(SayToMeApi),
  buildClaudeStopHandlers(SayToMeApi),
  buildCodexStopHandlers(SayToMeApi),
  buildGrokStopHandlers(SayToMeApi),
  buildOpenCodeCompactHandlers(SayToMeApi),
  buildOpenCodeModelControlsHandlers(SayToMeApi),
  buildNotificationsHandlers(SayToMeApi),
  buildPushHandlers(SayToMeApi),
  buildUserMessagesPollHandlers(SayToMeApi),
  buildClaudeActivityHandlers(SayToMeApi),
  buildCursorActivityHandlers(SayToMeApi),
  buildCodexActivityHandlers(SayToMeApi),
  buildGrokActivityHandlers(SayToMeApi),
  buildExternalCliResolveHandlers(SayToMeApi),
  buildExternalCliDiscoverHandlers(SayToMeApi),
  buildSessionContextHandlers(SayToMeApi),
  buildCliSessionsHandlers(SayToMeApi),
  buildNotesHandlers(SayToMeApi),
  buildMessageControlsHandlers(SayToMeApi),
  buildDevSessionsHandlers(SayToMeApi),
  buildOpenCodeActivityPreviewHandlers(SayToMeApi),
  buildSessionFoldersHandlers(SayToMeApi),
  buildSearchHandlers(SayToMeApi),
  buildQuickSearchHandlers(SayToMeApi),
  buildProviderModelsHandlers(SayToMeApi),
  buildSessionModelsHandlers(SayToMeApi),
  buildCurrentModelHandlers(SayToMeApi),
  buildSessionReasoningEffortHandlers(SayToMeApi),
  buildSessionOpenCodeReasoningEffortHandlers(SayToMeApi),
);

const SayToMeLive = Layer.mergeAll(
  HealthLive,
  SessionMutationsLive,
  JarvisStatusOpenCodeLive,
  MessageCreateLive,
  JarvisTimerLive,
  OpenCodeSessionsLive,
  OpenCodeWorkspaceLive,
  StopOpenCodeLive,
  StopCursorLive,
  StopClaudeLive,
  StopCodexLive,
  StopGrokLive,
  StopPaseoLive,
  CompactOpenCodeLive,
  OpenCodeModelControlsLive,
  OpenCodeModelSessionLive,
  NotificationsLive,
  PushLive,
  NotesLive,
  MessageControlLive,
  SessionOrganizationLive,
  SessionModelSessionLive,
  ProviderModelsLive,
  SessionReasoningEffortServiceLive,
  SessionOpenCodeReasoningEffortServiceLive,
);

const SayToMeApiLive = HttpApiBuilder.api(SayToMeApi).pipe(
  Layer.provide(SayToMeHandlers),
  Layer.provide(SayToMeLive),
);

/** Live OpenAPI document generated from `SayToMeApi` (no hand-written spec). */
export function buildSayToMeOpenApiSpec() {
  return OpenApi.fromApi(SayToMeApi);
}

const sayToMeWebHandler = HttpApiBuilder.toWebHandler(
  Layer.mergeAll(
    // Publish GET /openapi.json from the Effect HttpApi definition.
    HttpApiBuilder.middlewareOpenApi({ path: "/openapi.json" }).pipe(
      Layer.provideMerge(SayToMeApiLive),
    ),
    HttpServer.layerContext,
  ),
);

export const sayToMeHttpApiWebHandler = sayToMeWebHandler.handler;
export const disposeSayToMeHttpApiHandler = sayToMeWebHandler.dispose;
