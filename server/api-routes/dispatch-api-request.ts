import { dispatchCodexDeliveryInternalRequest } from "./codex-delivery-internal.ts";
import { dispatchClaudeDeliveryInternalRequest } from "./claude-delivery-internal.ts";
import { dispatchCursorDeliveryInternalRequest } from "./cursor-delivery-internal.ts";
import { dispatchGrokDeliveryInternalRequest } from "./grok/grok-delivery-internal.ts";
import { dispatchEffectApiRequest } from "./effect-api.ts";
import { dispatchSseApiRequest } from "./sse-routes.ts";
import { dispatchEmbedWidgetRequest } from "../embed/solid/widget.ts";
import { dispatchLiveChildInternalRequest } from "../external-cli/live-child.ts";

export async function dispatchApiRequest(request: Request): Promise<Response | null> {
  const embedWidgetResponse = await dispatchEmbedWidgetRequest(request);
  if (embedWidgetResponse) return embedWidgetResponse;
  const liveChildResponse = await dispatchLiveChildInternalRequest(request);
  if (liveChildResponse) return liveChildResponse;
  const claudeDeliveryResponse = await dispatchClaudeDeliveryInternalRequest(request);
  if (claudeDeliveryResponse) return claudeDeliveryResponse;
  const cursorDeliveryResponse = await dispatchCursorDeliveryInternalRequest(request);
  if (cursorDeliveryResponse) return cursorDeliveryResponse;
  const codexDeliveryResponse = await dispatchCodexDeliveryInternalRequest(request);
  if (codexDeliveryResponse) return codexDeliveryResponse;
  const grokDeliveryResponse = await dispatchGrokDeliveryInternalRequest(request);
  if (grokDeliveryResponse) return grokDeliveryResponse;
  const effectResponse = await dispatchEffectApiRequest(request);
  if (effectResponse) return effectResponse;
  return dispatchSseApiRequest(request);
}
