## Why

A bot's Chat is one flat stream. When the user and a bot work on several things at once, follow-ups about one topic interleave with everything else and the conversation becomes hard to follow (issue #604). Chat apps solve this with optional per-message threads: most messages stay in the main stream, and any message can grow a side conversation without cluttering it.

Technically, the message log has no notion of a reply, so neither the UI nor a bot's runtime tools can keep a side conversation together, and an execution started by a follow-up has no way to know which conversation it belongs to.

## What Changes

- Any top-level message, from the user or the bot, can have a **thread**: replies that belong to it. Threads are one level deep; naming a reply as the thread posts to that reply's thread. Threads are optional; nothing changes for messages without replies.
- The message log stores replies alongside other messages, with a `threadId` naming the root. Reading the main stream returns top-level messages only; each root with replies carries a thread summary (reply count, time and sequence of the last reply, and who has replied). Each root also records the sequence of its latest bot reply, so the UI can tell bot replies the user has not seen. A thread can be read on its own with the same bounded, cursor-paginated reads. Search spans every message.
- A retried post is matched by its idempotency key before its thread is resolved, so a lost response can always be replayed.
- Posting a reply changes its root's summary and is announced with a `message.thread` event on the root, so every client and execution can refresh it. Deleting a root deletes its whole thread.
- **Bot runtime tools:** `chat_post` takes an optional `threadId`; `chat_list` takes an optional `threadId` to read one thread; summaries and `chat_get` show a message's `threadId` and a root's thread summary.
- **Executions from a thread:** a user reply starts a fresh execution like any user message. Its briefing names the thread and includes a bounded excerpt of the root and the latest replies, and tells the agent to answer in that thread with `chat_post` and `threadId`.
- **Chat UI (Slack-style):**
  - Each top-level message offers **Reply in thread** from a small hover/focus action on the message and from its message menu.
  - A root with replies shows a compact reply bar under it: who replied, "N replies", and when the last reply came; it is marked when it holds bot replies newer than this device's read position.
  - Choosing either opens a **thread panel** beside the chat (over it on narrow layouts): the root message, a reply count divider, the replies, and its own composer with attachments. The panel follows new replies live, closes with its close button or Escape, and keeps a per-thread draft while the bot tab is open.
  - Thread replies stay out of the main stream. Quote, Edit and Delete work on replies inside the panel; deleting a root with replies says it deletes the replies too.
- Bot posts in threads raise the bot's notification like any post. Threads add no new way to acknowledge (ADR-0104); what already acknowledges in Chat covers replies whose roots or panel it shows.

Out of scope (listed as follow-ups in the PR): "also send to main chat", per-thread read positions and unread counts, following/muting threads, and thread-aware trigger prompts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bot-message-log`: adds the requirements "Message threads", "Thread reads and events", "Thread runtime tools", "Executions from a thread reply", "Reply in thread", "Thread panel" and "Thread notifications"; modifies "Briefings trim in a fixed order" so thread context is trimmed first.

## Impact

- `packages/protocol/src/botMessages.ts`: `threadId` and `thread` summary on messages and summaries.
- `packages/server-core/src/botService/messages.ts`: reply validation, main-stream/thread filtering, summaries, `message.thread` events, cascade delete.
- `packages/server-core/src/botService/messageProtocol.ts`, `service.ts`: `threadId` on user posts and list reads.
- `packages/server-core/src/botService/runtime.ts`: `chat_post`/`chat_list` `threadId`, thread context in briefings.
- `packages/client-core/src/botMessages.ts`: `threadId` on `post` and `list`.
- `src/workspace/bots/BotChat.tsx`, `BotTranscript.tsx`, new `BotComposer.tsx` and `BotThreadPanel.tsx`, `botPanels.css`: UI.
- Tests: server-core message store and runtime tests, client-core, `e2e/bots.spec.ts` with screenshots.
- No new privilege: every path stays behind existing bot authority and execution capabilities.
