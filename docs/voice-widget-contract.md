# Voice widget contract ledger

Host Contract v1 is intentionally limited to the two actual parent-facing T3
boundaries: `session-id` and `notes-base-url` are required; `ui-base-url`,
`storage-key`, and `timers-base-url` are optional. `storage-key` defaults to
`t3code:say-to-me-banner-collapsed:v1` and is JSON-boolean compatible;
`ui-base-url` defaults to `SAY_TO_ME_UI_URL`. The widget owns the single ID/Park
toolbar, and Park keeps the existing bubbling/composed `say-to-me-park-session`
event with `source`, `version`, `type`, and `sessionId`.

`can-autoplay` and audio-unlock ownership are deliberately deferred to the
audio slice because T3 currently owns that behavior inside the banner. Session
open is a direct STM-owned anchor using the existing `sayToMeSessionUrl`/
`sayToMeSessionLink` helpers, not a host event. Notes/timers base URL path
composition is deferred and must preserve the existing authenticated proxy shapes.

The only versioned events are `insert-usage-prompt` and `park-session`. No
generic widget aliases or additional host events are part of this contract.

The remaining migration work is deferred: banner composition/registration,
fetch/SSE, timers, storage implementation, audio, and T3/Paseo adapters are
separate slices. The reusable message-status, session-waiting badge, and `VoiceNoteSessionCard` presentation slices are now ported. The session card preserves T3 fallback/display, direct open anchor, waiting/latest/summary/details metadata, exact mention-copy payloads and confirmation lifecycle, and its DOM/dedicated `say-to-me-voice-widget` stylesheet characterization covers document/shadow-host tokens, compact sizing, interaction states, and coarse-pointer targets. The third parity correction restores every T3 short/max-height card rule, inherited radius token (including generic ID/Park controls), and the base line-height/background-clip distinctions. Banner composition and registration remain deferred.

The attachment-thumbnail presentation slice is ported as `VoiceNoteAttachments`. It preserves T3 ordering, image-only conditional rendering, full-quality attachment links, metadata-derived accessible names, intrinsic image sizing with `object-contain`, spacing, inherited radius tokens, short-height sizing, and T3 user-agent anchor hover/focus behavior. Its accessor form is reactive so later SSE note-list updates reconcile the rendered image links in place. The stricter image-data-URL whitelist and integer-id/string-originalName metadata guard are accepted extensions of the trust-boundary safety difference; no broader thumbnail acceptance is part of this slice.

Markdown presentation slice: STM parses `extraMarkdown` once on the server with satteri and emits sanitized `extraMarkdownHtml` through message and SSE serializers. VoiceNoteMarkdown accepts only that HTML projection; it does not parse Markdown in the browser. It applies the same explicit tag, attribute, and protocol boundary defensively, then parses the sanitized HTML with DOMParser and appends DOM nodes. External links use `_blank` and `noopener noreferrer`.

Cumulative non-identical cases: no T3 code-block header, highlighting, copy, wrap toggle, or file-link and favicon affordances are part of this widget slice. Serialization is server-owned, so the widget preserves server HTML rather than reproducing client parser-specific whitespace or fence metadata behavior. The explicit STM sanitizer remains narrower than rehype-sanitize default raw HTML, with client-side defense in depth.
