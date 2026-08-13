import { getAppSettings } from "../settings.ts";

export function listConfiguredPaseoInstanceIds(): string[] {
  return getAppSettings().paseoInstances.map((instance) => instance.id);
}
