/** Inputs for resolving how a session is labeled across the app. */
export type SessionDisplayInput = {
  id: string;
  alias?: string | null;
  opencodeTitle?: string | null;
  cwd?: string | null;
};

export function workspaceBasename(cwd: string | null | undefined): string | null {
  const trimmed = cwd?.trim();
  if (!trimmed) return null;
  return trimmed.split("/").filter(Boolean).pop() ?? trimmed;
}

function fallbackWithoutAlias(session: SessionDisplayInput): string {
  const providerTitle = session.opencodeTitle?.trim();
  if (providerTitle) return providerTitle;
  const workspace = workspaceBasename(session.cwd);
  if (workspace) return workspace;
  return session.id === "default" ? "default" : session.id;
}

/** List/organize scan label: alias ?? providerTitle ?? cwdBasename ?? id */
export function resolveListDisplayName(session: SessionDisplayInput): string {
  const alias = session.alias?.trim();
  if (alias) return alias;
  return fallbackWithoutAlias(session);
}

/** Session page line 1: alias ?? providerTitle ?? cwdBasename ?? id */
export function resolveSessionPageIdentityLabel(session: SessionDisplayInput): string {
  return resolveListDisplayName(session);
}

/** Session page line 2: providerTitle ?? cwdBasename ?? id */
export function resolveProviderTitleLabel(session: SessionDisplayInput): string {
  return fallbackWithoutAlias(session);
}
