import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function portlessCaPath(): string | null {
  const caPath = path.join(homedir(), ".portless", "ca.pem");
  return existsSync(caPath) ? caPath : null;
}

export function portlessCaPem(): string | null {
  const caPath = portlessCaPath();
  if (!caPath) return null;
  return readFileSync(caPath, "utf8");
}

export function portlessCaEnvVar(): string | null {
  const caPath = portlessCaPath();
  return caPath ? `NODE_EXTRA_CA_CERTS=${caPath}` : null;
}
