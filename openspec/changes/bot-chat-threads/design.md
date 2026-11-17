## Context

A bot's communication is one durable log per bot (`BotMessageStore`, `packages/server-core/src/botService/messages.ts`, ADR-0093). Rows are append-only revisions; `latest()` folds them to the current messages. `list()` pages summaries newest first with HMAC cursors bound to bot, epoch, kind and filter; `detail()` slices a body; `events()` serves a bounded monotonic event stream. User posts go through `bots.messages.post` (`messageProtocol.ts`) to `BotService.postUserMessage`, which persists and then dispatches a fresh execution linked by `origin.messageId`. Bot posts go through the runtime `chat_post` tool (`runtime.ts`) to `BotService.postBotMessage`. The execution briefing (`BotRuntime.briefing`) carries the trigger message detail and up to four recent message summaries within 8 KiB.

The UI is `BotChat.tsx`: it loads the latest 25 messages in full, follows `bots.messages.events`, and renders them through `BotTranscript` in a column beside `BotContextRail`. The composer (attachments, paste, drop, idempotent retry) is inline in `BotChat`.

Boundaries crossed: the protocol and the runtime MCP tools gain one optional field each. Both stay behind existing authority: `assertBotAuthority` for client operations and the execution capability (`runtime.current(id)`, bot derived server-side) for runtime tools. Thread IDs are looked up only inside the authorised bot's own store, so a foreign ID is indistinguishable from an unknown one. No renderer privilege, project/window or terminal-session boundary changes.

## Goals / Non-Goals

**Goals:** optional one-level threads on any top-level message; server-side persistence in the existing log; a Slack-style reply action, reply bar and thread panel; bots can read and post in threads, and an execution started from a thread reply knows its thread.

**Non-Goals:** "also send to main chat", per-thread read positions/unread counts, following or muting threads, nested threads, thread-aware triggers. These are follow-ups.

## Decisions

### Data model: a `threadId` on the row, summaries derived

`BotMessage` gains `threadId?: string` (the root ID) and `thread?: BotThreadSummary` (`{ replyCount, lastReplyAt, lastReplySequence, lastBotReplySequence, authors: ('user' | 'bot')[] }`, authors distinct, most recent first; `lastBotReplySequence` is `null` when only the user replied). `threadId` is stored on the row; `thread` is never stored: `public()`/`list()` compute it from `latest()` at read time, building one root→replies index per call. Internal mutations (`edit`, `setDispatch`, cascade delete) build new rows from the stored `Row` (a private `row()` lookup), never from the public message, so a derived summary cannot leak into the persisted state; a test reloads the store after a root edit and a dispatch update and inspects the JSON. Alternative: a stored counter on the root, bumped with a new root revision. Rejected: it would change the root's revision (breaking an in-flight edit with "message changed") and need repair on delete/clear. Derived summaries are always right, and the state file is already bounded to 10,000 messages.

Existing rows have no `threadId` and read as top-level; no migration. `parse()` accepts an optional 24-hex `threadId`.

### Posting a reply

`BotMessageStore.post` takes an optional `threadId`. The idempotency digest includes the *requested* `threadId` (only when present, so existing keys hash as before) and the key is checked first, as today; only a post that is not a replay resolves the target with `latest()`: missing/deleted → `not_found` ("Thread not found"); a reply → its own `threadId` (one level). The row stores the resolved root. So a retry after the named reply was deleted still returns the original message, and the same key with a different requested thread is a content conflict. The same post emits `message.posted` (reply) and `message.thread` (root, root's revision) in one save. `BotService.postUserMessage(botId, body, key, uploads, threadId?)` and `postBotMessage(executionId, body, key, captured, threadId?)` pass it through; the protocol `post` command and the runtime `chat_post` accept it as a 24-hex string.

### Reading

`list(botId, { cursor, limit, search, threadId })`:
- no `threadId`, no `search` → `latest()` filtered to rows without `threadId`;
- `threadId` → rows with that `threadId` (root must exist, else `not_found`), optionally searched;
- `search` without `threadId` → all rows (top-level and replies).
The cursor `filter` becomes `search` for the top-level list (unchanged) and `thread:<id>:<search>` for a thread, or `all:<search>` for a search, so cursors cannot cross scopes (existing `decode` check). `total` counts the filtered rows. Summaries carry `threadId` and `thread`.

`events` and their consumers are unchanged except for the new `message.thread` type. Deleting a reply emits `message.deleted` (reply) and `message.thread` (root). Deleting a root marks each reply deleted in the same save (one `message.deleted` per reply, then the root's), then prunes unreferenced attachments as today.

### Runtime tools and briefing

`chat_post` and `chat_list` gain `threadId` in their input schema. The bot's own store resolves it, so a foreign ID is "Thread not found", identical to an unknown one. The briefing's `context` gains `thread` only when the trigger message has a `threadId`: `{ rootId, root: { author, excerpt (≤1 KiB) }, replyCount, latestReplies: list(thread, limit 4).items }`. The budget loop trims `thread.latestReplies` first, then the root excerpt to 256 bytes, before recent top-level messages. One briefing line tells the agent: when `triggerMessage.message.threadId` is set, it was posted in that thread; answer with `chat_post` `threadId`, read more with `chat_list` `threadId`. Explicit, not an implicit default thread for `chat_post`: a silent default would make the same call behave differently by trigger and could not express "post at top level" without a sentinel.

### Acknowledgement

Threads add no cause of acknowledgement (ADR-0104: only what the user does acknowledges; the pending `bot-notifications-clear-only-on-interaction` change aligns the canonical requirements with it). `BotChat` computes `latest` as the maximum of loaded message sequences, loaded roots' `thread.lastReplySequence`, and the open thread's replies; the existing interaction-driven acknowledgement and the read-position bookkeeping use it unchanged. The unread divider still counts top-level bot messages only; the reply bar is marked new when `lastBotReplySequence > readThrough`.

### UI

- **`BotComposer.tsx` (new)** — the existing composer, extracted from `BotChat` with its pending files, upload tokens, paste/drop, send attempt and errors, parameterised by `draft`, `onDraftChange`, `placeholder`, `threadId` and an `onPosted` callback. The thread panel mounts it with `key={threadId}`, so pending files, upload tokens and the send attempt belong to one thread and are discarded when the panel switches threads or closes; only draft text is kept per thread (in `BotChat`). `send` captures `threadId` when it starts, so a post already under way lands in its own thread, and its result is applied only if that composer is still mounted. Both the main stream and the thread panel use it, so attachments, limits and idempotent retry behave identically. Alternative: a text-only thread composer. Rejected: replies with screenshots are a core chat use.
- **`BotTranscript`** gains optional `onReplyInThread(key)` and `threads: Map<key, BotThreadSummary>`. Top-level messages render a hover/focus-within action bar (one icon button, `MessageSquareReply`, label "Reply in thread") at the message's top-right, and, when a summary exists, a reply bar under the body: up to two author avatars (bot avatar / "You" badge), "N replies" (accent), and "Last reply <messageTime>". The reply bar is a `<button>`; `data-terminay-bot-thread-replies` carries the count and `data-new` marks new.
- **`BotThreadPanel.tsx` (new)** — an `<aside aria-label="Thread">` rendered in place of `BotContextRail` while open. Header: "Thread" and close button. Body: the root via `BotTranscript` (no reply action), a "N replies" divider, then replies via `BotTranscript`, with "Load older replies" when the thread list has a cursor. Footer: `BotComposer` with `threadId`. It loads `list({ threadId, limit: 25 })` and full details into a map keyed by ID, and "Load older replies" merges older pages into it (revision-wins, as the main stream does). It never reloads the newest page on a live event: `message.posted|edited|dispatch` fetches that one message and upserts it if its `threadId` is the open root; `message.deleted` removes it if it is a loaded reply (an unloaded reply's deletion only changes the count, which arrives with the root's `message.thread`); `message.edited|dispatch|thread` on the root refetches the root. Each load is tagged with the thread and a generation counter, and responses for a thread no longer open are dropped. A gap or clear resets the panel to its first page (or closes it if the root is gone). `BotChat` owns the open thread ID, the per-thread drafts (`Map`), and the single event loop; it forwards event batches to the panel by a version counter so there is one event cursor per bot view. Reply start failures render inside the panel, not the main stream.
- **Layout** — `.bots-thread` is 380px wide with a left border at desktop widths. Below 860px (the existing narrow breakpoint) and in the compact page it is absolutely positioned over `.bots-chatcol`, so the main stream keeps its scroll position underneath.
- **Menu** — "Reply in thread" after Quote for top-level messages. For a root with replies, Delete reads "Delete message and replies". Quote targets the composer the message is shown in.
- **Keyboard** — opening a thread focuses its composer; Escape closes the panel when focus is inside it and no menu or dialog is open, returning focus to the root message in the main stream.
- **Events in `BotChat`** — `message.posted|edited|dispatch` for a reply updates the open panel (if its thread) and not the main map; `message.thread` refetches the root if loaded; `message.deleted` of the open root closes the panel.

## Risks / Trade-offs

- [Deriving summaries scans the log per read] → One O(n) index per `list`/`get`, n ≤ 10,000, in memory; the same cost class as `latest()` already paid on every read.
- [Concurrent work on BotChat (#599, MCP tool calls in messages)] → Composer extraction moves code; merge `origin/main` before pushing and resolve by keeping both intents.
- [A bot answers at top level despite the briefing] → Visible but harmless; the briefing line and the tool description both state it, and the e2e/unit tests pin the tool contract.
- [Cascade delete removes replies the user did not look at] → The menu label says so explicitly.
- [Old clients ignore `threadId` and would show replies in the main stream] → The server-bundled UI ships with the server, so client and server change together.

## Migration Plan

None. Existing logs have no replies; the optional field defaults to top-level. Rollback to an older server would show replies as top-level messages, which is acceptable.

## Open Questions

None. ADR-0093 stays in force; this change adds a structure inside its message log (recorded as a new ADR, not a supersession).
