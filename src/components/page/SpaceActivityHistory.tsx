import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as stylex from "@stylexjs/stylex";
import { Link } from "react-router";

import { safeResponseJson } from "@say-to-me/runtime-validation";
import { SpaceActivityPayload, type SpaceActivityEvent } from "../../types.ts";
import { formatMessageTime } from "../../utils.ts";
import { history } from "./SpaceActivityHistory.stylex.ts";

type EventFilter = "all" | SpaceActivityEvent["type"];

const FILTERS: EventFilter[] = [
  "all",
  "message",
  "delivery",
  "notification",
  "timer",
  "attachment",
];

const RANGE_OPTIONS = [
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
] as const;

function glyph(type: SpaceActivityEvent["type"]): string {
  if (type === "delivery") return "!";
  if (type === "notification") return "n";
  if (type === "timer") return "t";
  if (type === "attachment") return "+";
  return "m";
}

function glyphStyle(type: SpaceActivityEvent["type"]) {
  if (type === "delivery") return history.glyphDelivery;
  if (type === "notification") return history.glyphNotification;
  if (type === "timer") return history.glyphTimer;
  if (type === "attachment") return history.glyphAttachment;
  return null;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.tabIndex !== -1 && el.getAttribute("aria-hidden") !== "true");
}

export type SpaceActivityHistoryProps = {
  open: boolean;
  spaceId: string;
  spaceName: string;
  onClose: () => void;
  /** Bump to force refetch after SSE-driven live updates. */
  refreshToken?: number;
  /** Element that opened the dialog; focus restored on close. */
  returnFocusTo?: HTMLElement | null;
};

export function SpaceActivityHistory({
  open,
  spaceId,
  spaceName,
  onClose,
  refreshToken = 0,
  returnFocusTo = null,
}: SpaceActivityHistoryProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [payload, setPayload] = useState<SpaceActivityPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<EventFilter>("all");
  const [windowHours, setWindowHours] = useState(168);

  useEffect(() => {
    if (!open) return;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const inertTargets: HTMLElement[] = [];
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.hasAttribute("data-space-activity-history")) continue;
      if (dialogRef.current && child.contains(dialogRef.current)) continue;
      child.setAttribute("inert", "");
      inertTargets.push(child);
    }
    const frame = requestAnimationFrame(() => {
      searchRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      for (const el of inertTargets) el.removeAttribute("inert");
      returnFocusTo?.focus();
    };
  }, [open, returnFocusTo]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = getFocusable(dialogRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    void fetch(
      `/api/spaces/${encodeURIComponent(spaceId)}/activity?hours=${encodeURIComponent(String(windowHours))}`,
    )
      .then(async (response) => {
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            `Unable to load space history: HTTP ${response.status}${text ? ` - ${text.slice(0, 180)}` : ""}`,
          );
        }
        return safeResponseJson(response, SpaceActivityPayload);
      })
      .then((next) => {
        if (!active) return;
        setPayload(next);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, spaceId, refreshToken, windowHours]);

  const filtered = useMemo(() => {
    const events = payload?.events ?? [];
    const needle = search.trim().toLowerCase();
    return events.filter((event) => {
      if (kind !== "all" && event.type !== kind) return false;
      if (!needle) return true;
      const haystack =
        `${event.sessionTitle} ${event.title} ${event.detail} ${event.type}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [payload, search, kind]);

  if (!open) return null;

  const retention = payload?.retention;

  return createPortal(
    <div {...stylex.props(history.layer)} data-space-activity-history>
      <button
        {...stylex.props(history.backdrop)}
        type="button"
        aria-label="Close space history"
        onClick={onClose}
      />
      <section
        {...stylex.props(history.panel)}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header {...stylex.props(history.header)}>
          <div>
            <span {...stylex.props(history.eyebrow)}>SPACE ACTIVITY</span>
            <strong {...stylex.props(history.title)} id={titleId}>
              Recent activity
            </strong>
            <span {...stylex.props(history.description)}>
              {spaceName} · currently attached sessions · newest first
            </span>
          </div>
          <button
            {...stylex.props(history.close)}
            type="button"
            aria-label="Close history"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div {...stylex.props(history.controls)}>
          <input
            {...stylex.props(history.search)}
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search sessions and events"
            aria-label="Search space history"
          />
          <div {...stylex.props(history.filterRow)}>
            <div {...stylex.props(history.chips)} aria-label="Event type filters">
              {FILTERS.map((filter) => (
                <button
                  {...stylex.props(history.chip, kind === filter && history.chipActive)}
                  type="button"
                  aria-pressed={kind === filter}
                  onClick={() => setKind(filter)}
                  key={filter}
                >
                  {filter === "all" ? "All events" : filter}
                </button>
              ))}
            </div>
            <select
              {...stylex.props(history.range)}
              value={windowHours}
              onChange={(event) => setWindowHours(Number(event.target.value))}
              aria-label="History time range"
            >
              {RANGE_OPTIONS.map((option) => (
                <option value={option.hours} key={option.hours}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div {...stylex.props(history.list)}>
          <span {...stylex.props(history.countLabel)}>
            {filtered.length} EVENTS · NEWEST FIRST
            {retention
              ? ` · ${retention.appliedRangeHours}h window · msg scan ≤${retention.messageScanLimit}`
              : ""}
          </span>
          {error ? <p {...stylex.props(history.error)}>{error}</p> : null}
          {!error && loading && !payload ? (
            <p {...stylex.props(history.empty)}>Loading persisted activity…</p>
          ) : null}
          {!error && !loading && filtered.length === 0 ? (
            <p {...stylex.props(history.empty)}>
              No persisted events match these filters for currently attached sessions.
            </p>
          ) : null}
          {filtered.map((event) => {
            const body = (
              <>
                <strong {...stylex.props(history.eventTitle)}>{event.sessionTitle}</strong>
                <span {...stylex.props(history.eventDetail)}>
                  {event.title}: {event.detail}
                </span>
                <span {...stylex.props(history.eventMeta)}>
                  <span {...stylex.props(history.typeTag)}>{event.type}</span>
                  {event.type === "notification" ? <span>from notifications table</span> : null}
                  {event.type === "message" ? <span>from messages table</span> : null}
                  {event.dismissedAt ? <span>dismissed</span> : null}
                </span>
              </>
            );
            return (
              <article {...stylex.props(history.event)} key={event.id}>
                <span {...stylex.props(history.glyph, glyphStyle(event.type))} aria-hidden="true">
                  {glyph(event.type)}
                </span>
                <span>
                  {event.url ? (
                    <Link {...stylex.props(history.eventLink)} to={event.url} onClick={onClose}>
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </span>
                <time {...stylex.props(history.eventTime)} dateTime={event.createdAt}>
                  {formatMessageTime(event.createdAt) || event.createdAt}
                </time>
              </article>
            );
          })}
          {retention ? (
            <span {...stylex.props(history.note)}>
              {retention.scopeNote} Notifications retained globally to the newest{" "}
              {retention.notificationRetentionLimit} rows.{" "}
              {retention.messageScanTruncated
                ? `Message scan hit the ${retention.messageScanLimit}-row cap; older messages may be omitted. `
                : ""}
              {retention.timerFreshnessNote}
            </span>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
