import * as stylex from "@stylexjs/stylex";

// The message/session feed: status badges, the queue panel + heading, the
// thread list/items, and the per-row meta line. Shared by the message list,
// the session list, and the notes list.

const mobile = "@media (max-width: 680px)" as const;

// ─── Status badges ────────────────────────────────────────────────────────────

export const badge = stylex.create({
  base: {
    borderRadius: "999px",
    paddingBlock: "0.2rem",
    paddingInline: "0.6rem",
    backgroundColor: "#e4e7ec",
    color: "#344054",
    display: "inline-flex",
    alignItems: "center",
    whiteSpace: "nowrap",
  },
  separator: {
    marginInline: "0.3rem",
  },
  segmentLink: {
    color: "#175cd3",
    textDecoration: {
      default: "none",
      ":hover": "underline",
    },
    cursor: "pointer",
    display: "inline-block",
    maxWidth: {
      default: "12rem",
      [mobile]: "8rem",
    },
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  context: {
    boxSizing: "border-box",
    flexBasis: {
      [mobile]: "100%",
    },
    flexWrap: "wrap",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "normal",
    width: {
      [mobile]: "100%",
    },
  },
  speaking: { backgroundColor: "#fef0c7", color: "#93370d" },
  played: { backgroundColor: "#dcfae6", color: "#067647" },
  done: { backgroundColor: "#dcfae6", color: "#067647" },
  stopped: { backgroundColor: "#fee4e2", color: "#b42318" },
  pending: { backgroundColor: "#fef0c7", color: "#93370d" },
  failed: { backgroundColor: "#fee4e2", color: "#b42318" },
  listening: { backgroundColor: "#fef0c7", color: "#93370d" },
});

// ─── Queue panel ────────────────────────────────────────────────────────────

export const queue = stylex.create({
  panel: {
    marginTop: "1rem",
    padding: "1.25rem",
  },
  heading: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "1rem",
    alignItems: {
      default: "center",
      [mobile]: "flex-start",
    },
    flexWrap: {
      [mobile]: "wrap",
    },
    rowGap: {
      default: "0.75rem",
      [mobile]: "0.5rem",
    },
    columnGap: {
      default: "0.75rem",
      [mobile]: "0.5rem",
    },
  },
  headingH2: {
    marginTop: 0,
    marginBottom: 0,
  },
  headingCount: {
    color: "#667085",
  },
  badges: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: {
      default: "flex-end",
      [mobile]: "flex-start",
    },
    rowGap: "0.4rem",
    columnGap: "0.4rem",
  },
});

// ─── Thread list ──────────────────────────────────────────────────────────────

export const thread = stylex.create({
  list: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    rowGap: "0.85rem",
    columnGap: "0.85rem",
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  item: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "22px",
    backgroundColor: "#fffdf8",
    padding: "1rem",
  },
  projectItem: {
    backgroundColor: "var(--project-bg, #fffdf8)",
    backgroundImage: "var(--project-pattern)",
    backgroundPosition: "0 0, 0 0",
    backgroundRepeat: "repeat",
    backgroundSize: "96px 96px",
  },
  projectItemContent: {
    paddingTop: "0.8rem",
    paddingRight: "0.8rem",
    paddingBottom: "0.8rem",
    paddingLeft: "0.8rem",
    borderRadius: "16px",
    backgroundColor: "rgba(255, 253, 248, 0.86)",
    boxShadow: "0 8px 24px rgba(23, 32, 42, 0.08)",
  },
  group: {
    color: "#8a4b20",
    fontSize: "0.78rem",
    fontWeight: 800,
    letterSpacing: "0.12em",
    marginTop: "1rem",
    marginBottom: "0.6rem",
    textTransform: "uppercase",
  },
  details: {
    marginTop: "1rem",
  },
  summary: {
    cursor: "pointer",
    color: "#8a4b20",
    fontSize: "0.78rem",
    fontWeight: 800,
    letterSpacing: "0.12em",
    marginBottom: "0.6rem",
    textTransform: "uppercase",
  },
});

export const messageMeta = stylex.create({
  root: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.85rem",
    marginBottom: "0.7rem",
    minWidth: 0,
    color: "#667085",
    alignItems: {
      default: "center",
      [mobile]: "flex-start",
    },
    flexWrap: {
      [mobile]: "wrap",
    },
    rowGap: {
      default: "0.75rem",
      [mobile]: "0.5rem",
    },
    columnGap: {
      default: "0.75rem",
      [mobile]: "0.5rem",
    },
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    minWidth: 0,
    maxWidth: "100%",
    marginTop: "0.2rem",
    alignItems: {
      default: "center",
      [mobile]: "stretch",
    },
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    flexDirection: {
      [mobile]: "column",
    },
    width: {
      [mobile]: "100%",
    },
  },
  /** Anchor styled as a button (replaces .message-actions a combinator rule). */
  actionLink: {
    alignItems: "center",
    borderWidth: 0,
    borderRadius: "999px",
    cursor: {
      default: "pointer",
      ":disabled": "not-allowed",
    },
    font: "inherit",
    backgroundColor: "#17202a",
    color: "#fff",
    paddingBlock: "0.75rem",
    paddingInline: "1.05rem",
    display: {
      default: "inline-flex",
      [mobile]: "flex",
    },
    textDecoration: "none",
    justifyContent: {
      [mobile]: "center",
    },
    opacity: {
      ":disabled": 0.45,
    },
  },
});
