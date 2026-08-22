# Busy vs Idle (User Experience)

## Purpose

Say To Me has one product question that every human and every Jarvis
coordinator depends on: **is this session still working, or is it free?**

This spec is that question as people experience it. It does not describe how
the app decides, stores, or delivers that answer. The experience must stay
true if the delivery worker is rewritten.

## Audience

- People looking at session lists, cards, space rosters, and the open chat.
- Jarvis coordinators waiting on another session, or waiting on their own
  turn to finish before they take the next step.

## Product language

### Working

A session is **working** from the moment a task is in its hands until that
task is actually finished.

Working includes all of these:

- Thinking, reading, searching, or using tools.
- Sleeping or waiting as part of the task (a pause is not a finish).
- Posting progress in the chat: "starting now", mid-task updates, screenshots,
  links, tables.
- A first "starting" ping. That ping means work began. It is not the end of
  work.

If a person would still say "leave it alone, it's busy," the product must
still present it as working.

### Idle

A session is **idle** only when the current task is really done and the
session is waiting for a new prompt.

Idle is not "it said something." Idle is "it is finished." The last real
answer from the agent is already in the chat. The session is free.

## A turn, from the outside

A coordinator asks a worker to write a spec. The worker says "starting now."
The watcher still waits. That line means work began, not that it finished.

The worker keeps going: reading, writing the file, maybe a progress line.
The watcher still waits. Progress is not idle. A human looking at that
session still sees busy, and can Stop from the Say To Me UI. If they only
see idle, they cannot cancel from the app.

The worker's last real message is the result: the spec is in, here is the
path. Then the worker is idle. Only then does the watcher hear one "Session
is now idle."

If idle is announced after "starting now" and before that result, the
product lied. The watcher was told the session was free while it was still
on the task.

## What people see

These surfaces must tell the same story at the same moment. A session must
not look idle on one and working on another.

**Session list and session cards.** The status label and latest-activity
summary follow the session. While it is working, the card reads as busy or
working, and the summary is the latest progress or reply. After it goes idle,
the card reads as idle. Idle system copy is valid latest activity once work
has actually finished. Cards update live; people should not need Refresh to
see busy become idle.

**Waiting-on-idle.** A held message, a "waiting for this session to go idle"
routine, or a coordinator wait must keep waiting while the session is
working. They resolve only when the session is idle. Mid-task progress does
not release the wait. A first starting ping does not release the wait.

**Stop.** Stop is how you cancel work you can see. It must agree with list,
cards, roster, and waiting-on-idle. While the session is working, people
must see it as busy **and** be able to Stop from the Say To Me UI. When the
session is idle, Stop is not the control for an in-flight task — there is
no in-flight task to cancel. If the agent is working but the UI looks idle,
that is the same idle-while-working bug, in a worse form: Stop is missing,
so people leave the UI and cancel from the API.

<!-- today: Stop copy is "Stop Cursor", "Stop Claude", "Stop OpenCode", and so on. -->

**Space roster.** The roster badge agrees with the list and cards: working
sessions stay in the working group; idle sessions move to idle. Sorting that
puts actionable sessions ahead of idle ones must not promote a still-working
session into idle.

**Open chat.** While working, people see the agent's own messages. When a
watcher is owed an idle notice, they see a short idle line such as "Session
is now idle." (or the watched session's name: "Morgan is now idle"). That
line is a status cue. It is not the agent's answer.

<!-- today: spoken/shown idle copy is "Session is now idle." -->

## What people hear

People should hear the agent's answer. The idle phrase must not replace it.

- **Working session, listening to that session.** Hear progress, then the
  real answer. Do not have "Session is now idle" spoken over or instead of
  that answer. Do not inject an idle phrase into that session as if it were
  a new instruction to the agent.
- **Watcher / coordinator, listening to their own session.** After the worker
  finishes, hear one idle notice that the other session is now idle. That
  notice may name the session. It is in addition to, not instead of, the
  worker's answer living in the worker's chat.
- **Quiet on self-finish.** Ending your own turn must not speak an idle
  phrase that wakes you. Your answer is the end of the turn, not a cue to
  start another turn.

Idle notices are high-signal and rare. They are not a running commentary.

## Who is told, and when

Idle is a fact about **one session's current task**. Who hears about it
depends on who was waiting.

### The working session itself

When a session finishes its own turn, **do not notify that session that it
is now idle.**

The agent already produced its answer there. Telling it "you are idle"
would look like a new user message, restart work, and loop. Coordinators
must not be woken by their own turn ending.

People looking at that session still **see** it become idle on list, card,
roster, waiting-state, and Stop. Seeing idle is not the same as posting an
idle notice into the chat. Stop disappearing is part of that same idle
picture — not a separate story.

### A watcher (human or Jarvis)

When session A sends work to session B, or asks to be told when B is free,
session A is a **watcher**.

- As soon as B has the work, A may see a promise such as "you will be
  notified once the session is idle."
- While B is working — including starting pings, tool use, sleep, and
  progress voice — A is not told that B is idle.
- When B's task really finishes, A gets **one** idle notice, at that
  moment: not early, not missing, not repeated.
- B's own chat gets the answer. A's chat gets the idle cue. A can then
  look at B, or take the next step.

A coordinator watching several workers gets one idle notice **per finished
task**, not a burst, and not a recap of tasks that already notified.

If nobody is watching, do not invent watcher notices. List, card, and roster
still show idle.

## Must-pass rules

1. **Never present a session as idle while it is still working.** Sleeping,
   thinking, using tools, or posting progress mid-task is still working. A
   first "starting" ping is not the end of work.
2. **One idle signal at the right time.** When work really finishes,
   watchers and waiting surfaces get that signal: not early, not missing,
   not stuck busy forever.
3. **Do not spam.** One idle notice per finished task. A coordinator must
   not be woken by its own turn ending. A coordinator watching another
   session should be told that worker finished — once.
4. **Surfaces agree.** Session list / cards, waiting on idle, space roster,
   Stop, and spoken or shown "Session is now idle." tell the same
   busy-or-idle story. Working means busy **and** Stop is available in the
   UI. Idle means Stop is not offered as a cancel for work that is not
   in flight.
5. **The answer is the content.** People hear the agent's answer. The idle
   phrase does not replace it.

## Failure modes (user-visible bugs)

These are bugs people can see or hear. They are not implementation notes.

**Idle while working.** The list, card, roster, waiting chip, Stop, or a
spoken "Session is now idle" claims the session is free, but it is still
thinking, using tools, sleeping, or posting progress. Coordinators treat a
starting ping as "done" and pile on the next task. Worst form: idle is
announced after "starting now" and before the real answer. A worse form
for humans: the UI looks idle, so Stop never appears, and they have to
cancel from the API.

**Never idle after finish.** The agent already answered and stopped, but
the session stays busy on every surface. Held messages never send. Watchers
never hear. Jarvis waits until it times out. The person stares at a finished
chat that still says working.

**Duplicate pings.** The same finished task produces two or more idle
notices. A watcher is woken twice. TTS says "Session is now idle" again.
Routines fire twice. One finish, one notice.

**Self-wake loop.** A session is told it is idle in its own chat. That
notice is treated as a new prompt, work starts again, idle fires again.
The coordinator never rests. People hear a loop of idle phrases instead of
silence after the answer.

**Idle phrase replaces the answer.** Playback speaks "Session is now idle"
instead of the agent's last real reply, or the idle line overwrites what
people came to hear. Status ate the content.

**Surfaces disagree.** The roster says idle, the open card says working, or
Jarvis is told idle while the human still sees busy. Stop is missing while
the badge says working, or Stop is showing while everything else says idle.
People stop trusting the badge, and they cannot cancel work they can see.

**Stop missing while working.** The agent is still on the task, but the Say
To Me UI does not show busy, so Stop never appears. People leave the UI and
cancel from the API. That is idle-while-working with the cancel control
gone.

**Watcher left in the dark.** A coordinator sent work to another session and
was promised a notify. The worker finished. Nobody told the watcher. The
next step never happens unless a human notices.

## What this spec is not

This spec does not describe jobs, stamps, compare-and-swap, HTTP reopen,
provider liveness checks, database columns, or internal function names. Those
details change. The experience above must still hold.

Related product docs (cards, force-send, routines, push, Stop) should
follow this busy-vs-idle meaning. They should not invent a second
definition of idle. [CLI Provider Stop](./cli-provider-stop.md) says what
Stop does once it is visible; visibility uses this spec's meaning of busy.
