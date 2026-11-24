## ADDED Requirements

### Requirement: Message threads

A message MAY be posted as a reply in a thread. A thread SHALL be named by its root: a top-level message that is not itself a reply. A reply SHALL record the root's ID as its `threadId`. Threads SHALL be one level deep: a post that names a reply as its thread SHALL be stored in that reply's thread. A post that names a message that does not exist, has been deleted or belongs to another bot SHALL be refused with no message created and no execution started. A message posted without a thread SHALL be top-level. Threads SHALL NOT change author provenance, ordering, revisions, attachments or idempotency: a reply has its own ID, sequence and revision in the same log. The idempotency key SHALL be checked before the thread is resolved: a retried post with the same key, content and requested thread SHALL return the original reply even if the message it named has since been deleted, and a post reusing a key with a different requested thread SHALL be refused as a conflict.

Deleting a root SHALL delete every reply in its thread. Deleting a reply SHALL leave its root and the other replies. Editing a root or a reply SHALL change only that message. Clearing the chat SHALL remove every thread.

#### Scenario: User replies in a thread
- **WHEN** the user posts "Use staging" with the thread set to Bird's top-level message M
- **THEN** the message is stored with `threadId` M and does not appear among top-level messages

#### Scenario: Reply to a reply
- **WHEN** a post names reply R of thread M as its thread
- **THEN** the post is stored with `threadId` M

#### Scenario: Unknown or deleted root
- **WHEN** a post names a deleted message, an unknown ID or another bot's message as its thread
- **THEN** it is refused, no message is created and no execution starts

#### Scenario: Retry after the named reply was deleted
- **WHEN** a post naming reply R as its thread succeeds, R is then deleted, and the client retries with the same idempotency key and content
- **THEN** the original reply is returned and no second message or execution is created

#### Scenario: Same key, different thread
- **WHEN** a post reuses an idempotency key with the same text but a different thread
- **THEN** it is refused as a conflict and no message is created

#### Scenario: Delete a root
- **WHEN** the user deletes a root whose thread has three replies
- **THEN** the root and its three replies are deleted, and the attachments only they referenced are removed

#### Scenario: Delete one reply
- **WHEN** the user deletes one of three replies in a thread
- **THEN** the root and the two other replies remain and the root's reply count becomes 2

### Requirement: Thread reads and events

A message list without a thread SHALL return top-level messages only. A list naming a thread SHALL return that thread's replies, newest first, with the same page size, response-size bound, scope-bound cursors and snapshot rules as the top-level list; its cursor SHALL be refused for any other thread or for the top-level list. A list with a search SHALL match top-level messages and replies alike, unless it names a thread, when it SHALL match only that thread's replies. Every message and summary SHALL carry its `threadId`, or none for a top-level message.

A root with at least one reply SHALL carry a thread summary: its reply count, the time and sequence of its latest reply, the sequence of its latest bot reply, and which authors, the user or the bot, have replied, most recent first. A root without replies SHALL carry none. The summary SHALL be derived from the replies present when it is read, so edits, deletions and clears are reflected without stored counters, and SHALL NOT be persisted with the root or change the root's revision.

Posting or deleting a reply SHALL emit, besides the reply's own event, a `message.thread` event whose subject is the root, so clients and executions following events can refresh the root's summary. Events SHALL remain bounded summaries without bodies.

#### Scenario: Main stream excludes replies
- **WHEN** Bird's log holds two top-level messages and one of them has four replies
- **THEN** the top-level list returns two items, and the one with replies carries a summary with a reply count of 4

#### Scenario: Summary survives a root edit
- **WHEN** a root with two replies is edited and its execution dispatch is updated, and the server restarts
- **THEN** the root's revision reflects only the edit and its summary still reports two replies

#### Scenario: Read a thread
- **WHEN** a client lists thread M with a limit of 2 and its thread has five replies
- **THEN** it receives the two newest replies and a cursor that continues to the older replies of M only

#### Scenario: Cursor from another thread
- **WHEN** a cursor issued for thread M is used to list thread N or the top-level list
- **THEN** the request is refused without revealing the other scope

#### Scenario: Search finds a reply
- **WHEN** a client searches for "staging" and only a reply in thread M contains it
- **THEN** the result contains that reply with `threadId` M

#### Scenario: Reply event
- **WHEN** Bird posts a reply in thread M
- **THEN** the event stream carries `message.posted` for the reply and `message.thread` for M

### Requirement: Thread runtime tools

`chat_post` SHALL accept an optional `threadId`. With it, the bot's post SHALL be a reply in that thread under the rules of Message threads; without it, a top-level message. `chat_list` SHALL accept an optional `threadId` and then list that thread's replies. `chat_list` summaries and `chat_get` SHALL show each message's `threadId` and a root's thread summary. A thread named by a runtime tool SHALL belong to the calling execution's bot; any other SHALL be refused without revealing whether it exists. Runtime tools SHALL stay within their existing item, byte and authority bounds.

#### Scenario: Bot replies in a thread
- **WHEN** a live execution calls `chat_post` with text "Done" and `threadId` M
- **THEN** a bot reply with `threadId` M is stored and Chat shows it in M's thread, not in the main stream

#### Scenario: Bot reads a thread
- **WHEN** a live execution calls `chat_list` with `threadId` M
- **THEN** it receives bounded summaries of M's replies and a continuation cursor when more remain

#### Scenario: Another bot's thread
- **WHEN** an execution calls `chat_post` with the ID of another bot's message as `threadId`
- **THEN** the post is refused and neither bot's log changes

### Requirement: Executions from a thread reply

A user reply in a thread SHALL start a fresh execution, as any accepted user message does. That execution's briefing SHALL name the thread's root ID, carry a bounded excerpt of the root with its author, the thread's reply count and bounded excerpts of its latest replies, and SHALL tell the agent to answer in that thread by passing `threadId` to `chat_post` and to read more of it with `chat_list`. Thread context SHALL count towards the briefing budget and SHALL be trimmed as Briefings trim in a fixed order requires. An execution started by a top-level message SHALL carry no thread context. Every briefing SHALL explain that threads are one level deep, that top-level lists show only top-level messages with a reply-count summary and not the replies, and that the agent should read a thread with `chat_list` and its `threadId` when the thread looks relevant to its task.

#### Scenario: Reply starts a threaded execution
- **WHEN** the user replies "and the logs?" in thread M
- **THEN** a fresh execution starts whose briefing names M, its root excerpt and latest replies, and instructs the agent to post with `threadId` M

#### Scenario: Top-level message beside an active thread
- **WHEN** the user posts a top-level message while message M has 6 replies
- **THEN** the briefing lists M with a reply count of 6 and no reply text, and explains that the agent can read M's thread with `chat_list` and `threadId` M when it is relevant

#### Scenario: Large thread
- **WHEN** the user replies in a thread with 200 long replies
- **THEN** the briefing stays within its budget and keeps the trigger message and the thread's root ID

### Requirement: Reply in thread

Each top-level message in Chat SHALL offer **Reply in thread**, both as an action shown on the message while the pointer is over it or focus is within it, and as an item of its message menu after Quote. A reply SHALL NOT offer Reply in thread. A root with replies SHALL show a reply bar beneath it naming who has replied, the reply count and when the latest reply was posted; activating the reply bar SHALL open that thread. The reply bar SHALL be marked new when the thread's latest bot reply was posted after this device's read position for that bot. Thread replies SHALL NOT appear in the main stream, and the unread divider SHALL count top-level messages only.

#### Scenario: Start a thread from the hover action
- **WHEN** the user points at a bot message and activates Reply in thread
- **THEN** the thread panel opens for that message with its composer focused

#### Scenario: Reply bar
- **WHEN** a root has three replies, the latest from the bot five minutes ago
- **THEN** the reply bar under it shows the bot's avatar, "3 replies" and the latest reply's time

#### Scenario: New replies while away
- **WHEN** the bot replies in thread M while the user is on another screen, and the user then opens Chat
- **THEN** M's reply bar is marked new and the main stream gains no message for the reply

#### Scenario: Only the user replied since
- **WHEN** thread M's only bot reply is older than this device's read position and the user has replied since
- **THEN** M's reply bar is not marked new

### Requirement: Thread panel

Opening a thread SHALL show a thread panel beside the main stream, or over it where the chat is too narrow for both, with the root message, a divider giving the reply count, the replies oldest first with paginated older replies, and a composer. The panel composer SHALL behave as the main composer does: attachments by button, drop and paste with the same limits, Enter to send, failure kept with draft and files, and retries reusing the same idempotency key. A message sent from it SHALL be a reply in that thread. Each thread SHALL keep its own draft text while the bot tab stays open. Pending files and an unsent attempt SHALL belong to the thread they were added in: switching to another thread or closing the panel SHALL discard that thread's pending files, never carry them into another thread. A send already under way SHALL complete into the thread it was started in. New, edited and deleted replies and changes to the root SHALL appear in the panel live, without discarding older replies already loaded or moving the reading position. Replies SHALL offer Quote, Edit message and Delete message from their message menu, and Quote SHALL append to the panel's draft. Deleting a root whose thread has replies SHALL be labelled as deleting its replies too. The panel SHALL close with its close button or Escape, and SHALL close when its root is deleted or the chat is cleared. Opening a different thread SHALL replace the panel's contents.

#### Scenario: Reply from the panel
- **WHEN** the thread panel for M is open and the user types "Ship it" and presses Enter
- **THEN** a reply with `threadId` M appears in the panel, the main stream is unchanged except for M's reply bar showing one more reply, and a fresh execution starts

#### Scenario: Bot reply arrives live
- **WHEN** the panel for M is open and the bot posts a reply in M
- **THEN** the reply appears at the end of the panel without reloading

#### Scenario: Reply deleted elsewhere
- **WHEN** the panel for M shows older replies loaded by scrolling up and a reply is deleted on another device
- **THEN** only that reply disappears, the older replies stay loaded, and the divider shows the new count

#### Scenario: Root edited elsewhere
- **WHEN** the panel for M is open and M is edited on another device
- **THEN** the panel's root shows the edited text

#### Scenario: Reply start failure
- **WHEN** a reply sent from the panel fails to start an execution
- **THEN** its failure with Retry and Dismiss appears in the panel, not in the main stream

#### Scenario: Separate drafts
- **WHEN** the user types "draft A" in thread M's composer, opens thread N, and returns to M
- **THEN** M's composer holds "draft A" and N's composer was empty

#### Scenario: Switching threads drops pending files
- **WHEN** an image is pending in thread M's composer and the user opens thread N
- **THEN** N's composer has no pending files, and returning to M shows its draft text without the image

#### Scenario: Chat cleared while open
- **WHEN** the panel for M is open and the chat is cleared
- **THEN** the panel closes

#### Scenario: Root deleted while open
- **WHEN** the panel for M is open and M is deleted on another device
- **THEN** the panel closes and the main stream no longer shows M

#### Scenario: Close with Escape
- **WHEN** focus is in the thread panel and no menu or dialog is open and the user presses Escape
- **THEN** the panel closes

#### Scenario: Narrow chat
- **WHEN** the chat is narrower than the layout needs for both and the user opens a thread
- **THEN** the panel covers the main stream, and closing it returns to the main stream at the same scroll position

### Requirement: Thread notifications

A bot's reply in a thread SHALL count as a bot post for its notification, its excerpt and its acknowledgement, exactly as a top-level post does. Whatever acknowledges a bot's posts in Chat SHALL acknowledge through the latest sequence the client has observed, where a client has observed a reply when it shows the reply's root with a summary whose latest reply sequence covers it, or shows the reply in an open thread panel. Threads SHALL NOT add any new cause of acknowledgement: a reply arriving while Chat is shown SHALL NOT acknowledge it by itself.

#### Scenario: Bot replies in a thread while Chat is not shown
- **WHEN** Bird replies in thread M while nobody views Bird's Chat
- **THEN** Bird's notification counts the reply and shows its excerpt

#### Scenario: Acting in Chat acknowledges thread replies
- **WHEN** Bird's notification covers one thread reply and the user, in Bird's Chat where M's reply bar shows it, acts in Chat
- **THEN** the acknowledgement covers that reply and Bird's notification is removed

#### Scenario: Deleting the thread updates the notification
- **WHEN** Bird's notification covers only replies in thread M and M is deleted
- **THEN** Bird's notification is removed

## MODIFIED Requirements

### Requirement: Briefings trim in a fixed order
When a briefing exceeds its budget, it SHALL drop entries in this order until it fits: the thread's latest replies, then the root excerpt cut to 256 bytes, then older recent messages, then unhealthy triggers, then failed executions, then other active executions. Trigger identity and content, and the thread's root ID, SHALL always be kept.

#### Scenario: Worst-case failure text
- **WHEN** ten failed executions and ten failing triggers all have 1 KiB reasons of multibyte and JSON-escaped characters
- **THEN** the briefing stays within its budget and lists at most five of each, cut on UTF-8 boundaries

#### Scenario: Thread context trims first
- **WHEN** a reply execution starts in a thread whose latest replies and root are long, with ten long recent messages
- **THEN** the briefing drops the thread's latest replies and cuts the root excerpt before dropping any recent message, and keeps the root ID
