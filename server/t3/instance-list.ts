import {
  getAppSettings,
  getStoredT3ServerInstance,
  type T3ServerInstanceStored,
} from "../settings.ts";

/** Public ids configured in settings (no secrets). */
export function listConfiguredT3InstanceIds(): string[] {
  return getAppSettings().t3ServerInstances.map((instance) => instance.id);
}

export function listStored(): T3ServerInstanceStored[] {
  return listConfiguredT3InstanceIds()
    .map((id) => getStoredT3ServerInstance(id))
    .filter((instance): instance is T3ServerInstanceStored => instance != null);
}
