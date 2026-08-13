import { Fragment } from "react";
import { Link } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { ORGANIZE_ROOT_CRUMB_ID } from "../session-organize-path.ts";
import { session as sessionStyles } from "../styles/session.stylex.ts";
import type { OrganizePathCrumb } from "../types.ts";

type OrganizePathBreadcrumbsProps = {
  path: readonly OrganizePathCrumb[];
};

function organizeCrumbHref(crumb: OrganizePathCrumb): string {
  return crumb.id === ORGANIZE_ROOT_CRUMB_ID ? "/organize" : `/organize/${crumb.id}`;
}

export function OrganizePathBreadcrumbs({ path }: OrganizePathBreadcrumbsProps) {
  if (!path.length) return null;

  return (
    <nav aria-label="Organize folder" {...stylex.props(sessionStyles.organizePathRow)}>
      {path.map((crumb, index) => (
        <Fragment key={crumb.id}>
          {index > 0 ? (
            <span {...stylex.props(sessionStyles.organizePathSep)} aria-hidden="true">
              /
            </span>
          ) : null}
          <Link {...stylex.props(sessionStyles.organizePathLink)} to={organizeCrumbHref(crumb)}>
            {crumb.name}
          </Link>
        </Fragment>
      ))}
    </nav>
  );
}
