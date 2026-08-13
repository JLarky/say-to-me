import type { ExternalCliActivitySnapshot } from "../types.ts";
import { SafeHtml } from "./SafeHtml.tsx";

type StyleXProps = {
  className?: string;
  "data-style-src"?: string;
  style?: Readonly<{ [key: string]: string | number }>;
};

type ActivityItem = ExternalCliActivitySnapshot["items"][number];

/** Prefer server-sanitized HTML; fall back to plain text for stale payloads. */
export function ExternalCliActivityBody({
  item,
  styleProps,
}: {
  item: ActivityItem;
  styleProps?: StyleXProps;
}) {
  if (item.html) {
    return <SafeHtml html={item.html} styleProps={styleProps} />;
  }
  return <pre {...(styleProps || {})}>{item.text}</pre>;
}
