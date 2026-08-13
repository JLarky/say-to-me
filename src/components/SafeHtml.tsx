import { memo } from "react";

type StyleXProps = {
  className?: string;
  "data-style-src"?: string;
  style?: Readonly<{ [key: string]: string | number }>;
};

/** Inject server-sanitized HTML (messages + activity). No client markdown parsing. */
export const SafeHtml = memo(function SafeHtml({
  className,
  html,
  styleProps,
}: {
  className?: string;
  html: string;
  styleProps?: StyleXProps;
}) {
  const props = styleProps || {};
  return (
    <div
      {...props}
      className={`${props.className || ""} ${className || ""}`.trim() || undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}, areSafeHtmlPropsEqual);

function areSafeHtmlPropsEqual(
  previous: { className?: string; html: string; styleProps?: StyleXProps },
  next: { className?: string; html: string; styleProps?: StyleXProps },
) {
  return (
    previous.className === next.className &&
    previous.html === next.html &&
    previous.styleProps?.className === next.styleProps?.className &&
    previous.styleProps?.["data-style-src"] === next.styleProps?.["data-style-src"] &&
    shallowStyleEqual(previous.styleProps?.style, next.styleProps?.style)
  );
}

function shallowStyleEqual(
  previous?: Readonly<{ [key: string]: string | number }>,
  next?: Readonly<{ [key: string]: string | number }>,
) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) return false;
  return previousKeys.every((key) => previous[key] === next[key]);
}
