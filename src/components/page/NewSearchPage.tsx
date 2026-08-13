import { safeResponseJson } from "@say-to-me/runtime-validation";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router";
import * as stylex from "@stylexjs/stylex";

import { loadPrototypeProfile, profileInitials } from "../../new-space-prototype.ts";
import { DashboardLiveRefreshProvider } from "../../dashboard-live-refresh.tsx";
import {
  sessionListLabel,
  sessionProviderLabel,
  showSessionIdSubline,
} from "../../session-label.ts";
import { SearchResponseSchema, type SearchResponseSchema as SearchResponse } from "../../types.ts";
import { chrome } from "./NewDashboardChrome.stylex.ts";
import { Icon, Sidebar, Topbar } from "./NewDashboardChrome.tsx";
import { search } from "./NewSearchPage.stylex.ts";

type ResultTarget =
  | { kind: "session"; href: string; id: string }
  | { kind: "message"; href: string; id: string };

function sessionHrefFor(sessionId: string, href?: string | null): string {
  if (href && href.startsWith("/")) return href;
  return `/ses/${sessionId}`;
}

function truncate(text: string, max = 220): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function NewSearchPage() {
  const [params, setParams] = useSearchParams();
  const initialQ = params.get("q") ?? "";
  const [q, setQ] = useState(initialQ);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [profile] = useState(loadPrototypeProfile);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const statusId = useId();

  useEffect(() => {
    document.title = q ? `Search: ${q} — Say To Me` : "Search — Say To Me";
  }, [q]);

  async function runSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) {
      setResult(null);
      setError("");
      setActiveIndex(-1);
      setParams({});
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/search?${new URLSearchParams({ q: trimmed })}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await safeResponseJson(res, SearchResponseSchema);
      setResult(data);
      setActiveIndex(-1);
      setParams({ q: trimmed });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResult(null);
      setActiveIndex(-1);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialQ) void runSearch(initialQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targets = useMemo<ResultTarget[]>(() => {
    if (!result) return [];
    const sessions = result.sessions.map((s) => ({
      kind: "session" as const,
      id: `session:${s.id}`,
      href: sessionHrefFor(s.id, s.href),
    }));
    const messages = result.messages.map((m) => ({
      kind: "message" as const,
      id: `message:${m.sessionId}:${m.id}`,
      href: sessionHrefFor(m.sessionId),
    }));
    return [...sessions, ...messages];
  }, [result]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void runSearch(q);
  }

  function onQueryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!targets.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % targets.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? targets.length - 1 : index - 1));
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0 && result && q.trim() === result.query) {
      event.preventDefault();
      const anchor = document.querySelector<HTMLAnchorElement>(
        `[data-search-result="${targets[activeIndex].id}"]`,
      );
      anchor?.click();
    }
  }

  const statusText = loading
    ? "Searching…"
    : error
      ? `Search error: ${error}`
      : result
        ? `${result.sessions.length} sessions and ${result.messages.length} messages`
        : "Enter a query to search sessions and messages.";

  return (
    <DashboardLiveRefreshProvider>
      <div {...stylex.props(chrome.root, chrome.shell)}>
        <Sidebar active="search" initials={profileInitials(profile.name)} />
        <div {...stylex.props(search.main)}>
          <Topbar title="Search" crumb="FIND ANYTHING" />
          <div {...stylex.props(search.content)}>
            <section {...stylex.props(search.intro)}>
              <span {...stylex.props(search.eyebrow)}>SEARCH</span>
              <h1 {...stylex.props(search.heading)}>Find sessions and messages.</h1>
              <p {...stylex.props(search.lede)}>
                Match session ids, aliases, and titles, plus message text, links, and extra
                markdown.
              </p>
            </section>

            <form {...stylex.props(search.form)} onSubmit={onSubmit} role="search">
              <div {...stylex.props(search.field)}>
                <span {...stylex.props(search.fieldIcon)} aria-hidden="true">
                  <Icon name="search" />
                </span>
                <input
                  {...stylex.props(search.input)}
                  ref={inputRef}
                  data-app-search-input
                  type="search"
                  value={q}
                  autoFocus
                  aria-label="Search sessions and messages"
                  aria-controls={resultsId}
                  aria-describedby={statusId}
                  placeholder="Search sessions and messages"
                  onChange={(event) => {
                    setQ(event.target.value);
                    setActiveIndex(-1);
                  }}
                  onKeyDown={onQueryKeyDown}
                />
                {q ? (
                  <button
                    {...stylex.props(search.clear)}
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                      setQ("");
                      setResult(null);
                      setError("");
                      setActiveIndex(-1);
                      setParams({});
                      inputRef.current?.focus();
                    }}
                  >
                    Clear
                  </button>
                ) : null}
                <button {...stylex.props(search.submit)} type="submit" disabled={loading}>
                  {loading ? "Searching…" : "Search"}
                </button>
              </div>
            </form>

            <div {...stylex.props(search.status)} id={statusId} role="status" aria-live="polite">
              {statusText}
            </div>

            {error ? (
              <div {...stylex.props(search.error)} role="alert">
                {error}
              </div>
            ) : null}

            <div id={resultsId}>
              {result && result.query ? (
                <>
                  <section {...stylex.props(search.section)} aria-label="Session results">
                    <div {...stylex.props(search.sectionHeading)}>
                      <h2 {...stylex.props(search.sectionTitle)}>Sessions</h2>
                      <span {...stylex.props(search.sectionCount)}>{result.sessions.length}</span>
                    </div>
                    {result.sessions.length === 0 ? (
                      <p {...stylex.props(search.empty)}>No matching sessions.</p>
                    ) : (
                      <ul {...stylex.props(search.list)}>
                        {result.sessions.map((s, index) => {
                          const href = sessionHrefFor(s.id, s.href);
                          const active = activeIndex === index;
                          const display = {
                            id: s.id,
                            alias: s.alias,
                            opencodeTitle: s.title,
                            cwd: s.cwd,
                          };
                          const label = sessionListLabel(display);
                          const provider = sessionProviderLabel(display);
                          const meta = [
                            provider !== label ? provider : null,
                            showSessionIdSubline(display) ? s.id : null,
                            s.state,
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <li key={s.id}>
                              <Link
                                {...stylex.props(search.result, active && search.resultActive)}
                                to={href}
                                data-search-result={`session:${s.id}`}
                                aria-current={active ? "true" : undefined}
                                onMouseEnter={() => setActiveIndex(index)}
                              >
                                <span {...stylex.props(search.resultTitle)}>{label}</span>
                                {meta ? (
                                  <span {...stylex.props(search.resultMeta)}>{meta}</span>
                                ) : null}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>

                  <section {...stylex.props(search.section)} aria-label="Message results">
                    <div {...stylex.props(search.sectionHeading)}>
                      <h2 {...stylex.props(search.sectionTitle)}>Messages</h2>
                      <span {...stylex.props(search.sectionCount)}>{result.messages.length}</span>
                    </div>
                    {result.messages.length === 0 ? (
                      <p {...stylex.props(search.empty)}>No matching messages.</p>
                    ) : (
                      <ul {...stylex.props(search.list)}>
                        {result.messages.map((m, index) => {
                          const offset = result.sessions.length + index;
                          const href = sessionHrefFor(m.sessionId);
                          const active = activeIndex === offset;
                          const display = {
                            id: m.sessionId,
                            alias: m.sessionAlias,
                            opencodeTitle: m.sessionTitle,
                            cwd: m.sessionCwd,
                          };
                          const label = sessionListLabel(display);
                          const meta = [
                            showSessionIdSubline(display) ? m.sessionId : null,
                            `#${m.id}`,
                            m.author,
                            new Date(m.createdAt).toLocaleString(),
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <li key={`${m.sessionId}:${m.id}`}>
                              <Link
                                {...stylex.props(search.result, active && search.resultActive)}
                                to={href}
                                data-search-result={`message:${m.sessionId}:${m.id}`}
                                aria-current={active ? "true" : undefined}
                                onMouseEnter={() => setActiveIndex(offset)}
                              >
                                <span {...stylex.props(search.resultTitle)}>{label}</span>
                                <span {...stylex.props(search.resultMeta)}>{meta}</span>
                                <span {...stylex.props(search.resultBody)}>{truncate(m.text)}</span>
                                {m.extraMarkdown ? (
                                  <span {...stylex.props(search.resultExtra)}>
                                    {truncate(m.extraMarkdown, 160)}
                                  </span>
                                ) : null}
                                {m.links && m.links.length > 0 ? (
                                  <span {...stylex.props(search.resultLinks)}>
                                    {m.links.map((link) => (
                                      <span key={link} {...stylex.props(search.resultLink)}>
                                        {link}
                                      </span>
                                    ))}
                                  </span>
                                ) : null}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                </>
              ) : null}

              {!result && !loading && !error ? (
                <p {...stylex.props(search.empty)}>
                  Enter a query above to search sessions and messages.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </DashboardLiveRefreshProvider>
  );
}
