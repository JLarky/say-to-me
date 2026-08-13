/** Pathname gate for Cmd/Ctrl+K and palette availability. */
export function isQuickSearchPath(pathname: string): boolean {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  if (trimmed === "/search") return true;
  if (trimmed === "/dashboard") return true;
  if (trimmed.startsWith("/dashboard/")) {
    const rest = trimmed.slice("/dashboard/".length);
    return rest.length > 0 && !rest.includes("/");
  }
  return false;
}
