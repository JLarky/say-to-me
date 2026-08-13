import React from "react";
import * as stylex from "@stylexjs/stylex";

import { controls } from "../styles/controls.stylex.ts";

export function FloatingActionButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button {...stylex.props(controls.button, controls.floating)} type="button" onClick={onClick}>
      {children}
    </button>
  );
}
