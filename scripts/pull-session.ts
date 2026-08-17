#!/usr/bin/env -S mise x deno -- deno run --allow-read --allow-env --allow-net
/* oxlint-disable anti-slop/no-unsafe-dictionary-type -- This diagnostic CLI transparently prints arbitrary JSON fields returned by the session poll endpoint. */

import { readFile } from "node:fs/promises";

const sessionId = process.argv[2];

if (!sessionId) {
  console.error("Usage: pull-session.ts <session-id>");
  process.exit(1);
}

const log = (fields: Record<string, unknown>) => console.log(JSON.stringify(fields));

// How long each poll waits server-side for a new user message before returning.
const pollTimeout = process.env.POLL_TIMEOUT ?? "5min";

log({
  pid: process.pid,
  msg: `this process will show you user messages as soon as they are posted to this session or idle notification if no messages were sent after ${pollTimeout}, change this value with POLL_TIMEOUT`,
});

// say.local is served with a cert from portless' local CA. Trust that CA so
// Deno's fetch doesn't reject the TLS handshake.
const home = process.env.HOME ?? "";
const caCerts = [await readFile(`${home}/.portless/ca.pem`, "utf8")];
// Deno-only: trust a custom CA for fetch. Reach it off globalThis so the Node
// type-checker (which has no Deno global) doesn't choke.
const { Deno } = globalThis as typeof globalThis & {
  Deno: { createHttpClient(options: { caCerts: string[] }): object };
};
const client = Deno.createHttpClient({ caCerts });
const baseUrl = process.env.SAY_TO_ME_URL ?? "https://say.local:1355";

type PollMessage = { id: number; [key: string]: unknown };
type PollResult = { messages: PollMessage[]; hasMore: boolean; timedOut: boolean };

const withoutEmpty = (obj: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(obj).filter(
      ([, value]) => value !== null && value !== 0 && !(Array.isArray(value) && value.length === 0),
    ),
  );

const withoutKeys = (obj: Record<string, unknown>, drop: string[]) =>
  Object.fromEntries(Object.entries(obj).filter(([key]) => !drop.includes(key)));

const droppedAttachmentKeys = ["thumbnailDataUrl", "thumbnailWidth", "thumbnailHeight"];

function cleanMessage(m: PollMessage): Record<string, unknown> {
  const attachments = Array.isArray(m.attachments)
    ? m.attachments.map((a) => withoutKeys(a as Record<string, unknown>, droppedAttachmentKeys))
    : m.attachments;
  return withoutEmpty({ ...m, attachments });
}

async function poll(params: string): Promise<PollResult> {
  const res = await fetch(
    `${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/user-messages-poll?${params}`,
    { client } as RequestInit,
  );
  if (!res.ok) {
    console.error(`\nuser-messages-poll request failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  return await res.json();
}

// No cursor yet: print the id of the last user message and start from there.
const initial = await poll("");
let sinceId = initial.messages.at(-1)?.id ?? 0;
log({ lastMessageId: sinceId || null });

// Long-poll for new user messages. The server blocks until one arrives (or its
// timeout), so print ids as they come and "." on an idle timeout — no client
// sleep needed. `since` advances past everything returned, so a backlog of more
// than `limit` just drains over successive polls.
while (true) {
  const { messages } = await poll(
    `since=${sinceId}&timeout=${encodeURIComponent(pollTimeout)}&limit=5`,
  );
  if (messages.length > 0) {
    for (const m of messages) log(cleanMessage(m));
    sinceId = messages[messages.length - 1].id;
  } else {
    log({ date: new Date().toISOString(), msg: "no new user messages" });
  }
}

export {};
