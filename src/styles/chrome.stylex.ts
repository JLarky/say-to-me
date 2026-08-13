import * as stylex from "@stylexjs/stylex";

// Page chrome shared across every route: the outer shell, the translucent card
// surface, the hero band, page typography, and page-level feedback (error/empty).

const mobile = "@media (max-width: 680px)" as const;

// ─── Layout ──────────────────────────────────────────────────────────────────

export const shell = stylex.create({
  root: {
    width: {
      default: "min(960px, calc(100% - 2rem))",
      [mobile]: "100%",
    },
    maxWidth: "100%",
    marginBlock: "0",
    marginInline: "auto",
    paddingTop: {
      default: "2rem",
      [mobile]: "0.5rem",
    },
    paddingRight: "0",
    paddingBottom: "4rem",
    paddingLeft: {
      default: "0",
      [mobile]: "0.5rem",
    },
  },
  tinted: {
    minHeight: "100vh",
    backgroundColor: "var(--project-bg, #f5f0e8)",
    backgroundImage: "var(--project-pattern)",
    backgroundPosition: "0 0, 0 0",
    backgroundRepeat: "repeat",
    backgroundSize: "96px 96px",
  },
});

export const card = stylex.create({
  base: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    overflow: "visible",
    overflowX: "clip",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: {
      default: "28px",
      [mobile]: "20px",
    },
    boxShadow: "0 18px 50px rgba(23, 32, 42, 0.08)",
  },
  /** Override for cards that contain absolutely-positioned children (e.g. dropdowns). */
  allowOverflow: {
    overflow: "visible",
    overflowX: "visible",
  },
});

// ─── Hero ─────────────────────────────────────────────────────────────────────

export const hero = stylex.create({
  root: {
    position: "relative",
    display: "flex",
    justifyContent: "space-between",
    rowGap: "1.5rem",
    columnGap: "1.5rem",
    alignItems: {
      default: "center",
      [mobile]: "stretch",
    },
    flexDirection: {
      [mobile]: "column",
    },
    padding: {
      default: "2rem",
      [mobile]: "1.25rem",
    },
    minWidth: 0,
  },
  copy: {
    minWidth: 0,
    flexGrow: "1",
    flexShrink: "1",
    flexBasis: "0%",
  },
  eyebrowRow: {
    display: "flex",
    alignItems: "center",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
    minWidth: 0,
    flexWrap: "wrap",
    position: "relative",
    zIndex: 1,
    isolation: "isolate",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    rowGap: "0.75rem",
    columnGap: "0.75rem",
  },
  notifications: {
    position: {
      default: "relative",
      [mobile]: "absolute",
    },
    top: {
      [mobile]: "1.25rem",
    },
    right: {
      [mobile]: "1.25rem",
    },
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "flex-start",
    zIndex: 30,
    marginLeft: {
      default: "auto",
      [mobile]: "0",
    },
  },
  notificationButton: {
    borderWidth: 0,
    cursor: "pointer",
    listStyle: "none",
    transformOrigin: "50% 0",
  },
  notificationButtonRinging: {
    animationName: stylex.keyframes({
      "0%": { transform: "rotate(0deg) scale(1)" },
      "12%": { transform: "rotate(15deg) scale(1.08)" },
      "24%": { transform: "rotate(-13deg) scale(1.08)" },
      "36%": { transform: "rotate(10deg) scale(1.06)" },
      "48%": { transform: "rotate(-7deg) scale(1.04)" },
      "60%": { transform: "rotate(5deg) scale(1.02)" },
      "72%": { transform: "rotate(-3deg) scale(1.01)" },
      "100%": { transform: "rotate(0deg) scale(1)" },
    }),
    animationDuration: "900ms",
    animationTimingFunction: "ease-in-out",
  },
  notificationLabel: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  notificationMenu: {
    position: "absolute",
    top: "calc(100% + 0.55rem)",
    right: 0,
    zIndex: 20,
    width: {
      default: "min(18rem, calc(100vw - 2rem))",
      [mobile]: "calc(100vw - 2rem)",
    },
    padding: "1rem",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "18px",
    backgroundColor: "#fffdf8",
    boxShadow: "0 18px 50px rgba(23, 32, 42, 0.16)",
  },
  notificationTitle: {
    display: "block",
    marginBottom: "0.4rem",
    color: "#17202a",
  },
  notificationEmpty: {
    margin: 0,
    color: "#667085",
  },
  notificationList: {
    display: "grid",
    rowGap: "0.75rem",
    margin: 0,
    padding: 0,
    listStyle: "none",
    maxHeight: "min(24rem, calc(100vh - 12rem))",
    overflowY: "auto",
    paddingRight: "0.25rem",
  },
  notificationItem: {
    display: "grid",
    rowGap: "0.2rem",
    paddingBottom: "0.75rem",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: "rgba(23, 32, 42, 0.08)",
  },
  notificationItemHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    columnGap: "0.5rem",
  },
  notificationDismiss: {
    width: "1.35rem",
    height: "1.35rem",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "rgba(23, 32, 42, 0.12)",
    borderRadius: "999px",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    color: "#667085",
    cursor: "pointer",
  },
  notificationLink: {
    display: "-webkit-box",
    color: "#17202a",
    textDecoration: "none",
    overflowWrap: "anywhere",
    overflow: "hidden",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 4,
  },
  notificationSession: {
    color: "#8a4b20",
    fontSize: "0.72rem",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    overflowWrap: "anywhere",
  },
  notificationTime: {
    color: "#667085",
    fontSize: "0.78rem",
  },
});

// ─── Typography ───────────────────────────────────────────────────────────────

export const text = stylex.create({
  title: {
    maxWidth: "100%",
    marginTop: 0,
    marginBottom: "0.5rem",
    fontSize: "clamp(2.4rem, 8vw, 5rem)",
    lineHeight: 0.9,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  },
  errorTitle: {
    marginTop: 0,
  },
  errorBody: {
    marginTop: 0,
  },
  eyebrow: {
    marginTop: "0",
    marginRight: "0",
    marginBottom: "0.4rem",
    marginLeft: "0",
    color: "#8a4b20",
    fontSize: "0.78rem",
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  },
  eyebrowInline: {
    marginBottom: 0,
  },
  lede: {
    marginTop: 0,
    maxWidth: "40rem",
    marginBottom: 0,
    color: "#52606d",
  },
});

// ─── Page-level feedback ───────────────────────────────────────────────────────

export const misc = stylex.create({
  error: {
    marginTop: "1rem",
    borderRadius: "16px",
    backgroundColor: "#fee4e2",
    color: "#912018",
    paddingBlock: "0.9rem",
    paddingInline: "1rem",
  },
  success: {
    marginTop: "1rem",
    borderRadius: "16px",
    backgroundColor: "#dcfae6",
    color: "#085d3a",
    paddingBlock: "0.9rem",
    paddingInline: "1rem",
  },
  enableSound: {
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
  empty: {
    color: "#667085",
  },
});
