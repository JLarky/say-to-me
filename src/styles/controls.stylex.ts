import * as stylex from "@stylexjs/stylex";

// Interactive controls (buttons, inputs, links styled as buttons) and the
// composer/form layout shared by the message composer and the form pages.

const mobile = "@media (max-width: 680px)" as const;

export const controls = stylex.create({
  button: {
    font: "inherit",
    borderWidth: 0,
    borderRadius: "999px",
    cursor: {
      default: "pointer",
      ":disabled": "not-allowed",
    },
    backgroundColor: "#17202a",
    color: "#fff",
    textDecoration: "none",
    userSelect: "none",
    paddingBlock: "0.75rem",
    paddingInline: "1.05rem",
    opacity: {
      ":disabled": 0.45,
    },
    minWidth: {
      [mobile]: 0,
    },
    width: {
      [mobile]: "100%",
    },
  },
  messageAction: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "43px",
    lineHeight: 1,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  secondary: {
    backgroundColor: "#efe5d7",
    color: "#17202a",
  },
  danger: {
    backgroundColor: "#b42318",
    color: "#fff",
  },
  compact: {
    fontSize: "0.82rem",
    paddingBlock: "0.34rem",
    paddingInline: "0.65rem",
  },
  autoMobileWidth: {
    flexBasis: {
      [mobile]: "auto",
    },
    width: {
      [mobile]: "auto",
    },
  },
  send: {
    marginLeft: "auto",
    flexBasis: {
      [mobile]: "auto",
    },
    width: {
      [mobile]: "auto",
    },
  },
  floating: {
    position: "fixed",
    right: {
      default: "1.25rem",
      [mobile]: "1rem",
    },
    bottom: {
      default: "1.25rem",
      [mobile]: "1rem",
    },
    zIndex: 10,
    boxShadow: "0 12px 34px rgba(23, 32, 42, 0.22)",
    width: {
      [mobile]: "auto",
    },
  },
  iconLink: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "2rem",
    height: "2rem",
    padding: 0,
    borderRadius: "999px",
    backgroundColor: "#efe5d7",
    color: "#17202a",
    fontSize: "1rem",
    lineHeight: 1,
    textDecoration: "none",
  },
  compactSecondaryLink: {
    display: "inline-flex",
    alignItems: "center",
    fontSize: "0.82rem",
    paddingBlock: "0.34rem",
    paddingInline: "0.65rem",
    backgroundColor: "#efe5d7",
    color: "#17202a",
    borderRadius: "999px",
    textDecoration: "none",
    fontWeight: 500,
  },
  textInput: {
    font: "inherit",
    minWidth: {
      [mobile]: 0,
    },
    width: {
      [mobile]: "100%",
    },
  },
  textarea: {
    font: "inherit",
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    resize: "vertical",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.16)",
    borderRadius: "20px",
    padding: "1rem",
    backgroundColor: "#fffdf8",
  },
  select: {
    font: "inherit",
    borderWidth: 0,
    borderRadius: "999px",
    cursor: "pointer",
    backgroundColor: "#efe5d7",
    color: "#17202a",
    paddingBlock: "0.65rem",
    paddingInline: "0.9rem",
    minWidth: {
      [mobile]: 0,
    },
    width: {
      [mobile]: "100%",
    },
  },
  checkboxInput: {
    font: "inherit",
    inlineSize: "1.1rem",
    blockSize: "1.1rem",
  },
});

// ─── Composer / form layout ────────────────────────────────────────────────────

export const composer = stylex.create({
  root: {
    marginTop: "1rem",
    padding: "1rem",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    flexWrap: "wrap",
  },
  options: {
    width: "100%",
    marginTop: "0.5rem",
  },
  optionsContent: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    marginTop: "0.75rem",
  },
  label: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    color: "#52606d",
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.5rem",
    columnGap: "0.5rem",
    color: "#52606d",
  },
});
