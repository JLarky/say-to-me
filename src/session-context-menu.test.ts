/** @vitest-environment jsdom */
import { describe, expect, it } from "vite-plus/test";

import {
  isSessionLinkContextTarget,
  isUnmodifiedPrimaryClick,
  sessionHref,
  shouldDismissSessionContextMenu,
} from "./session-context-menu.ts";

describe("isSessionLinkContextTarget", () => {
  it("detects session hrefs and their descendants", () => {
    const link = document.createElement("a");
    link.setAttribute("data-session-link", "");
    const child = document.createElement("strong");
    link.append(child);
    document.body.append(link);

    expect(isSessionLinkContextTarget(link)).toBe(true);
    expect(isSessionLinkContextTarget(child)).toBe(true);
    expect(isSessionLinkContextTarget(document.createElement("time"))).toBe(false);

    link.remove();
  });
});

describe("shouldDismissSessionContextMenu", () => {
  it("dismisses when the target is outside session rows and the menu", () => {
    const heading = document.createElement("h1");
    document.body.append(heading);
    expect(shouldDismissSessionContextMenu(heading)).toBe(true);
    heading.remove();
  });

  it("keeps the menu open for session row bodies and the popup itself", () => {
    const row = document.createElement("li");
    row.setAttribute("data-session-item", "");
    const body = document.createElement("time");
    row.append(body);
    const menu = document.createElement("div");
    menu.setAttribute("data-session-context-menu", "");
    const inside = document.createElement("button");
    menu.append(inside);
    document.body.append(row, menu);

    expect(shouldDismissSessionContextMenu(body)).toBe(false);
    expect(shouldDismissSessionContextMenu(inside)).toBe(false);

    row.remove();
    menu.remove();
  });

  it("dismisses when right-clicking a session href so only the browser menu remains", () => {
    const row = document.createElement("li");
    row.setAttribute("data-session-item", "");
    const link = document.createElement("a");
    link.setAttribute("data-session-link", "");
    link.href = "/ses/demo";
    row.append(link);
    document.body.append(row);

    expect(shouldDismissSessionContextMenu(link)).toBe(true);

    row.remove();
  });
});

describe("sessionHref", () => {
  it("builds an encoded session path", () => {
    expect(sessionHref("ses_8a6e1aba4983dIrSSmkVUyda9N")).toBe(
      "/ses/ses_8a6e1aba4983dIrSSmkVUyda9N",
    );
    expect(sessionHref("cur_a/b")).toBe("/ses/cur_a%2Fb");
  });
});

describe("isUnmodifiedPrimaryClick", () => {
  it("accepts only plain left clicks", () => {
    expect(
      isUnmodifiedPrimaryClick({
        button: 0,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(true);
    expect(
      isUnmodifiedPrimaryClick({
        button: 0,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(false);
    expect(
      isUnmodifiedPrimaryClick({
        button: 1,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe(false);
  });
});
