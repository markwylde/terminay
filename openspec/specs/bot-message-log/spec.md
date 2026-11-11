# bot-message-log Specification

## Purpose

Define durable bot communication, independent executions, bounded runtime tools, coordination, and attachments.

## Requirements

### Requirement: Independent communication and executions
A bot SHALL own a durable message log independent of execution diagnostics. Each accepted user message SHALL create a fresh provider execution, linked to its triggering message. User messages SHALL persist before dispatch and remain visible if execution fails. Agent output SHALL appear only in execution diagnostics; user-facing replies SHALL require an explicit scoped chat post. Agent posts SHALL NOT trigger new executions automatically.

#### Scenario: Two messages
- **WHEN** two user messages arrive while the first execution is running
- **THEN** each has a different execution ID and the second can coordinate before the first completes

#### Scenario: Silent execution
- **WHEN** an execution writes stdout or a provider final answer without posting a message
- **THEN** that output remains in execution details and does not become a chat reply

### Requirement: Bounded context and paginated tools
Execution briefings SHALL contain bot instructions, trigger identity/content, bounded recent message excerpts, message counts, bounded active execution summaries, and the bot's recent failures. MCP list/search tools SHALL default to 10 items, cap at 25 items and 8 KiB of response data, and return opaque scope-bound cursors and explicit truncation. Message bodies, execution transcripts and attachments SHALL NOT be expanded by list tools. Detail reads SHALL support bounded continuation. Snapshot pagination SHALL not duplicate records when new messages arrive.

#### Scenario: Large history
- **WHEN** an execution starts with thousands of messages and long bodies
- **THEN** it receives a bounded briefing and uses cursors or explicit detail reads for more context

#### Scenario: Cursor misuse
- **WHEN** a cursor is invalid or belongs to another bot, query, revision or snapshot
- **THEN** the request is refused without revealing that other scope

### Requirement: Incremental events
Bots SHALL expose a durable monotonic event cursor for message, execution, trigger configuration and coordination changes. Events SHALL be bounded summaries with IDs and revisions, not complete bodies or tool output. Reads SHALL return only events after the supplied cursor, with pagination and optional finite waiting. Expired cursors SHALL report a gap and a resynchronization path. Agent/tool clients SHALL request events on demand without a polling loop or unbounded subscription payload.

#### Scenario: Read changes
- **WHEN** an execution requests events after its last cursor
- **THEN** it receives only bounded subsequent changes and a continuation cursor

### Requirement: Scoped runtime MCP
Runtime tools SHALL be bound to a live server-authenticated bot and execution. They SHALL offer message list/search/get/post, execution list/get/post/stop/replace, a read of an ended execution's runner output, incremental events, management of the calling bot's triggers and shared-work coordination. They SHALL grant no project, terminal, host path or other bot authority. Request/response sizes, waits and execution concurrency SHALL be bounded. Revoked or terminal executions SHALL not post or mutate state. Retry-safe mutations SHALL accept idempotency keys.

#### Scenario: Execution revoked
- **WHEN** a stopped execution retries a chat post
- **THEN** it is refused and no late user-facing success message appears

### Requirement: Scoped trigger management
A live execution SHALL be able to list/search, read, create, update, delete, enable/disable, preview and run its own bot's triggers through runtime tools without a shell work lease. The server SHALL derive bot ownership from the execution capability. All writes SHALL require the observed server revision and refuse stale or repeated requests before changing state or launching work. The existing trigger service SHALL enforce schedule/event validation, time zone, minimum interval, trigger count and pending-firing cancellation. Run now SHALL start an independent execution.

Lists SHALL return bounded metadata without prompts, with scope/filter/revision-bound continuation and change-event cursors. Prompt detail SHALL use explicit bounded UTF-8-safe slices, with continuation invalidated by content changes. Trigger configuration changes SHALL emit bounded incremental events without prompt bodies, including changes made through the UI.

#### Scenario: Bot creates and changes a schedule
- **WHEN** a live bot execution creates a valid trigger and later reads and updates it with the current revision
- **THEN** the same persisted trigger appears in Configure, and the scheduler follows the revised definition

#### Scenario: Stale creation or Run now retry
- **WHEN** a tool request reuses a server revision after an earlier mutation succeeded
- **THEN** it fails with a conflict and creates no duplicate trigger or execution

#### Scenario: Trigger ownership and revocation
- **WHEN** an execution targets another bot's trigger or uses a revoked capability
- **THEN** the request is refused without changing either bot

#### Scenario: Large prompt and configuration changes
- **WHEN** an execution reads a trigger with a large prompt or follows a cursor after its configuration changes
- **THEN** prompt reads stay within the response budget, and stale continuation requires a fresh read

### Requirement: Corrections and replacement
A new execution SHALL be able to inspect other active executions, deliver a durable bounded inbox message or replace older work. Inbox delivery SHALL distinguish accepted from consumed. Replacement SHALL check an expected target revision, record supersession, revoke old mutation authority and await process cleanup before transferring shared-work ownership. A target already completed SHALL be reported explicitly. External effects already performed SHALL not be represented as undone.

#### Scenario: Correct destination
- **WHEN** a new execution interprets “BBC Sports instead” as a correction to an active BBC News execution
- **THEN** it can stop/supersede that execution, take shared-work ownership and post the corrected result without a late post from the old execution

### Requirement: Shared resources and admission
Fresh message executions SHALL not wait behind a single per-bot conversation turn. Normal concurrency SHALL be bounded with reserved coordination capacity. Shared desktop/shell work SHALL use server-managed ownership, while MCP coordination remains available without that ownership. Process groups and credentials SHALL remain execution-scoped; sibling executions share the bot container and are not security-isolated from one another.

#### Scenario: Busy desktop
- **WHEN** an execution owns shared work and a correction arrives
- **THEN** the correction execution can inspect and replace it without first obtaining desktop ownership

### Requirement: Durable messages and attachments
Messages SHALL have stable IDs, monotonic order, author provenance, timestamps and revisions. Edit/delete/clear SHALL act on communication records, never rewrite diagnostic transcripts or replay prior actions. Running executions SHALL observe these changes through events. Posted raster attachments SHALL be captured into bounded server-owned storage and remain readable after execution completion or container replacement. Tool results SHALL return attachment metadata rather than image bytes.

#### Scenario: Screenshot survives recreation
- **WHEN** a posted screenshot's original container file disappears
- **THEN** its durable message attachment remains available to authorized clients

### Requirement: Communication UI
Chat SHALL show the bot's shared message log with paginated history, explicit pending/failure states, message controls and inline durable attachments. Each message SHALL show its own author avatar, author name and the time it was posted, so consecutive messages from one author remain distinct. Session selection SHALL open execution details without changing chat history. Raw thoughts, tools and provider output SHALL remain in execution details. New chat and conversation continuation SHALL not define ordinary messaging behavior. Schedules and events SHALL start fresh executions with the same runtime tools and communication log.

Each device SHALL remember, per bot, the last message it has read. When Chat opens with bot messages posted after that point, a labelled divider SHALL mark where they begin, and SHALL stay in place for the rest of that visit. Leaving Chat, closing or leaving the bot tab, hiding the window, or sending a message SHALL mark every loaded message read. A bot this device has never shown SHALL start with every message read.

#### Scenario: Read execution details
- **WHEN** a user selects a recent execution
- **THEN** its diagnostics open separately and the shared chat log remains intact

#### Scenario: Consecutive bot messages
- **WHEN** a bot posts three messages in a row
- **THEN** Chat shows three messages, each with the bot's avatar, its name and its own posting time

#### Scenario: Unread divider
- **WHEN** a bot posts two messages while the user is on another screen, and the user then opens Chat
- **THEN** a divider labelled with the count of new messages appears directly above the first of them

#### Scenario: Read on leave
- **WHEN** the user opens Chat with unread messages, then switches to Configure and back to Chat
- **THEN** no divider is shown

#### Scenario: Long unread run
- **WHEN** Chat opens with unread messages taller than the message viewport
- **THEN** the viewport starts with the divider near its top rather than at the bottom

#### Scenario: Enter Chat with delayed images
- **WHEN** Chat becomes visible with no unread messages and message images load after the initial history render
- **THEN** the message viewport starts at the bottom and stays there as the content grows, without scroll animation
- **AND** manually scrolling up suspends automatic following until the user returns to the bottom or re-enters Chat
- **AND** browser layout/anchoring scroll events do not count as manual history scrolling
- **AND** the existing Sessions labels are retained

### Requirement: Briefings report recent failures
A briefing SHALL list up to 5 of the bot's executions that ended as failed or timed out in the last 24 hours, each with its compact origin and failure reason cut to 256 bytes. It SHALL also list up to 5 of the bot's triggers whose condition health is failed or blocked, each with its health error cut to 256 bytes.

#### Scenario: Briefing after failures
- **WHEN** a chat execution starts an hour after a trigger execution failed and while that trigger's condition check is failing
- **THEN** its briefing lists the failed execution with its reason and the trigger with its health error

### Requirement: Briefings trim in a fixed order
When a briefing exceeds its budget, it SHALL drop entries in this order until it fits: older recent messages, then unhealthy triggers, then failed executions, then other active executions. Trigger identity and content SHALL always be kept.

#### Scenario: Worst-case failure text
- **WHEN** ten failed executions and ten failing triggers all have 1 KiB reasons of multibyte and JSON-escaped characters
- **THEN** the briefing stays within its budget and lists at most five of each, cut on UTF-8 boundaries

### Requirement: Execution failure details
Execution list results SHALL carry a compact origin: its kind, any trigger ID and name, and for a failure origin the number of failures. They SHALL also carry the failure reason cut to 256 bytes and the structured failure cause. A single execution read SHALL add the reason cut to 1 KiB and, for a failure origin, its listed failures, within the 8 KiB response budget.

#### Scenario: Failure origin detail
- **WHEN** an execution reads a failure execution that lists 20 failures with 1 KiB reasons
- **THEN** the response stays within 8 KiB and says how many failures were left out

### Requirement: Runner output read
The runner output read SHALL accept only ended executions of the calling bot. It SHALL return the stored, already-redacted runner output in slices of at most 6 KiB of text. Without a cursor it SHALL return the last slice, and its cursor SHALL continue towards earlier output.

#### Scenario: Reading why an execution failed
- **WHEN** an execution reads the summary and then the runner output of a sibling execution that failed with `spawn EAGAIN`
- **THEN** the summary includes the failure reason, and the output read returns the end of the output, including the `EAGAIN` error, with a cursor for earlier output

#### Scenario: Running execution's output
- **WHEN** an execution asks for the runner output of an execution that is still running
- **THEN** the request is refused as a conflict that says the execution has not ended

#### Scenario: Another bot's output
- **WHEN** an execution asks for the runner output of an execution that belongs to another bot
- **THEN** the request is refused without revealing whether that execution exists

### Requirement: Bot posts raise a notification

A bot's own post to its message log SHALL raise a notification for that bot on its server. A user's post SHALL NOT raise one. A bot SHALL hold at most one notification, covering every bot post after its acknowledged sequence. A further post SHALL update that notification in place and SHALL NOT add a second one.

#### Scenario: A bot posts once

- **WHEN** the bot Bird posts `Build is green` and nobody views Bird's Chat
- **THEN** one notification for Bird is held

#### Scenario: A bot posts three times

- **WHEN** Bird posts three messages before anyone views its Chat
- **THEN** Bird holds one notification covering three posts

#### Scenario: A user post

- **WHEN** a user posts a message to Bird
- **THEN** no notification is raised for that post

### Requirement: Bot notification content

A bot notification SHALL carry the bot's identity, the number of its unacknowledged posts, a plain-text excerpt of the latest of them of at most 280 characters, and the time that post was made. A post with attachments and no text SHALL have an excerpt saying the bot sent an image. Editing an unacknowledged post SHALL update the notification to reflect the latest remaining one.

#### Scenario: Content of one post

- **WHEN** Bird posts `Build is green`
- **THEN** its notification has an unread count of 1, the excerpt `Build is green`, and the post's time

#### Scenario: An image without text

- **WHEN** Bird posts a screenshot with no text
- **THEN** its notification's excerpt says that Bird sent an image

#### Scenario: Latest post edited

- **WHEN** Bird's latest unacknowledged post is edited to `Build is red`
- **THEN** the notification's excerpt reads `Build is red` and its count is unchanged

### Requirement: Bot notification settle

A bot notification SHALL be published only after the settle period that applies to every notification, counted from the first unacknowledged post. One acknowledged while pending SHALL NEVER be shown to anyone. A post that updates a published notification SHALL NOT withdraw it or restart the settle period.

#### Scenario: Viewed within the settle period

- **WHEN** Bird posts while a user is already viewing Bird's Chat in a visible window
- **THEN** the post is acknowledged before the settle period ends and no client is ever shown a notification for it

#### Scenario: Update while published

- **WHEN** Bird's notification is published and Bird posts again
- **THEN** the published notification changes in place to a count of 2 and never disappears

### Requirement: Acknowledging bot posts

The server SHALL store one acknowledged sequence per bot, shared by every client. It SHALL only advance. An acknowledgement SHALL name the latest sequence its client observed, and the server SHALL advance to that sequence and no further. Bot posts after it SHALL remain unacknowledged. The bot's notification SHALL be removed for every client when no unacknowledged bot post remains. Acknowledgement SHALL require bot authority. It SHALL NOT change any device's read position or unread divider.

#### Scenario: A post races an acknowledgement

- **WHEN** a client acknowledges Bird through sequence 7 while Bird's post at sequence 8 is already stored
- **THEN** the acknowledged sequence becomes 7 and Bird's notification remains, covering one post

#### Scenario: A stale acknowledgement

- **WHEN** Bird's acknowledged sequence is 9 and a slower device acknowledges through 7
- **THEN** the acknowledged sequence stays 9

#### Scenario: Divider unaffected

- **WHEN** Bird's notification is dismissed from the Notifications list without opening Bird
- **THEN** the next time this device opens Bird's Chat, the unread divider still marks where Bird's new posts begin

### Requirement: What acknowledges bot posts

Each of the following SHALL acknowledge a bot's posts through the latest sequence it observed:

- a client showing that bot's Chat in a visible window;
- a bot post arriving while a client shows that Chat in a visible window;
- a user posting to that bot;
- dismissing the bot's notification, or **Clear all**.

A bot tab that is not in front, a Chat in a hidden window, and the Configure mode SHALL NOT acknowledge.

#### Scenario: Viewing on another device

- **WHEN** Bird's notification is published and a user opens Bird's Chat on a phone
- **THEN** the notification is removed on the phone and on the desktop

#### Scenario: Post while Chat is visible

- **WHEN** a user is viewing Bird's Chat in a visible window and Bird posts
- **THEN** that post is acknowledged and no notification is shown

#### Scenario: Hidden window

- **WHEN** Bird's tab is in Chat in a window that is hidden, and Bird posts
- **THEN** the post is not acknowledged and Bird's notification is published

#### Scenario: Dismissal races a post

- **WHEN** a user dismisses Bird's notification covering sequence 7 while Bird posts at sequence 8
- **THEN** sequence 8 remains unacknowledged and Bird holds a notification for it

### Requirement: Removing bot notifications

When every unacknowledged bot post is removed, or the chat is cleared, the bot's notification SHALL be removed. Deleting the bot SHALL remove its notification. A bot post after a clear SHALL raise a notification again.

#### Scenario: Latest post deleted

- **WHEN** Bird's notification covers two posts and the later one is deleted
- **THEN** the notification shows an unread count of 1 and the excerpt of the earlier post

#### Scenario: Only post deleted

- **WHEN** Bird's notification covers one post and that post is deleted
- **THEN** the notification is removed for every client

#### Scenario: Chat cleared, then a post

- **WHEN** Bird's chat is cleared while its notification is published, and Bird posts again
- **THEN** the notification is removed by the clear, and the new post raises a new one

#### Scenario: Bot deleted

- **WHEN** Bird is deleted while its notification is published
- **THEN** the notification is removed for every client

### Requirement: Bot acknowledgement survives restart

The acknowledged sequence SHALL be persisted with the bot's message log. After a server restart, a bot with unacknowledged posts SHALL hold its notification again, and a bot whose posts were all acknowledged SHALL NOT. A bot with no stored acknowledged sequence SHALL be treated as having acknowledged every existing message.

#### Scenario: Server restart

- **WHEN** the server restarts while Bird has unacknowledged posts
- **THEN** Bird's notification is held again after the restart, without Bird posting

#### Scenario: Restart after acknowledgement

- **WHEN** a user opens Bird's Chat and the server then restarts
- **THEN** no notification for Bird is held after the restart

#### Scenario: Existing history

- **WHEN** a server whose bots have message history but no stored acknowledged sequence starts
- **THEN** no bot notification is raised for that history

### Requirement: Bot notifications stay behind bot authority

A bot notification SHALL be visible only to clients that hold bot authority on its server. This SHALL include its publication, its changes, and its removal. A client without that authority, including one bound to a project, a session, or a capability, SHALL receive no record or event for it in a snapshot, a replay, or live delivery. Dismissing it SHALL require that authority. It SHALL NEVER be sent in a push banner or count toward one.

#### Scenario: Project-scoped client

- **WHEN** Bird's notification is published and later removed while a client bound to project "web" is attached
- **THEN** that client receives no record and no event of Bird's notification, live or in replay

#### Scenario: Read-only client

- **WHEN** a client attached with read scope only reads the notification snapshot
- **THEN** it receives no record of Bird's notification

#### Scenario: Dismissal without authority

- **WHEN** a client without bot authority asks to dismiss Bird's notification
- **THEN** it is refused and the notification remains

#### Scenario: Paired phone push

- **WHEN** Bird's notification is published while a paired phone is enrolled for push
- **THEN** no push banner names Bird or carries its excerpt, and the pushed count does not include it
