# ADR-0133: Bot message threads are one level deep and live in the message log

Status: accepted
Date: 2026-11-17

## Context

Users asked for optional per-message threads in a bot's Chat (issue #604). ADR-0093 makes a bot's durable message log the only communication channel between the user and its executions, read through bounded summaries, detail slices and events. A thread could live in a separate store, be nested arbitrarily, or be a flat reply link inside the existing log. Bots must be able to read and post in threads through the same scoped runtime tools, and an execution started by a reply must know which conversation it belongs to.

## Decision

1. **Same log, one level.** A reply is an ordinary message in the bot's log whose `threadId` names a top-level root. Naming a reply as the thread resolves to its root. There are no nested threads.
2. **Derived summaries.** A root's reply count, latest reply and authors are derived from the replies at read time and never stored, so the root's revision changes only when the root itself is edited. Thread changes are announced with a `message.thread` event on the root.
3. **Scoped reads.** The top-level list excludes replies; a thread is read with the same bounded, cursor-paginated list, its cursors bound to that thread; search spans all messages.
4. **Explicit threading for bots.** `chat_post` posts at top level unless given `threadId`. An execution started by a reply receives bounded thread context in its briefing and is told which `threadId` to use; there is no implicit default thread.
5. **Root deletion deletes the thread.**

## Consequences

- No new store, migration or authority path; threads inherit the log's authority, bounds, idempotency, events and attachment rules.
- Reads pay one in-memory pass to derive summaries, bounded by the log's 10,000-message limit.
- Future features (send to main chat, per-thread unread, follow/mute) build on `threadId` and the thread summary rather than a new model.
- Clients that do not understand `threadId` would show replies as top-level messages; the server-bundled UI ships with the server.
