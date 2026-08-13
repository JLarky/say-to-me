import { homedir } from "node:os";

export function externalCliStateRoot(): string {
  const override = process.env.SAY_TO_ME_EXTERNAL_CLI_STATE_ROOT?.trim();
  return override && override.length > 0 ? override : homedir();
}
