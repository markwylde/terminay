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
Execution briefings SHALL contain bot instructions, trigger identity/content, bounded recent message excerpts, message counts, the number of other active executions (running or waiting on the user) with bounded summaries of them, the number of queued executions, and the bot's recent failures. MCP list/search tools SHALL default to 10 items, cap at 25 items and 8 KiB of response data, and return opaque scope-bound cursors and explicit truncation. Message bodies, execution transcripts and attachments SHALL NOT be expanded by list tools. Detail reads SHALL support bounded continuation. Snapshot pagination SHALL not duplicate records when new messages arrive.

#### Scenario: Large history
- **WHEN** an execution starts with thousands of messages and long bodies
- **THEN** it receives a bounded briefing and uses cursors or explicit detail reads for more context

#### Scenario: Cursor misuse
- **WHEN** a cursor is invalid or belongs to another bot, query, revision or snapshot
- **THEN** the request is refused without revealing that other scope

#### Scenario: Other executions are running
- **WHEN** an execution starts while one other execution of the same bot is running
- **THEN** its briefing states that one other execution is active, summarises it, and asks the agent to decide whether to stop it, steer it, replace it or leave it running

#### Scenario: Queued work is not counted as active
- **WHEN** an execution starts while two executions are running, one is revoked and ending, and six are queued
- **THEN** its briefing reports two active executions, summarises only those two, and reports six queued executions

### Requirement: Incremental events
Bots SHALL expose a durable monotonic event cursor for message, execution, trigger configuration and coordination changes. Events SHALL be bounded summaries with IDs and revisions, not complete bodies or tool output. Reads SHALL return only events after the supplied cursor, with pagination and optional finite waiting. Expired cursors SHALL report a gap and a resynchronization path. Agent/tool clients SHALL request events on demand without a polling loop or unbounded subscription payload.

#### Scenario: Read changes
- **WHEN** an execution requests events after its last cursor
- **THEN** it receives only bounded subsequent changes and a continuation cursor

### Requirement: Scoped runtime MCP
Runtime tools SHALL be bound to a live server-authenticated bot and execution. They SHALL offer message list/search/get/post, execution list/get/post/stop/replace, a read of an execution's runner output and recent activity, incremental events, and management of the calling bot's triggers. They SHALL grant no project, terminal or host path authority, and no authority over another bot except the read-only inspection that the bot-inspection contract permits. Request/response sizes, waits and execution concurrency SHALL be bounded. Revoked or terminal executions SHALL not post or mutate state. Retry-safe mutations SHALL accept idempotency keys.

#### Scenario: Execution revoked
- **WHEN** a stopped execution retries a chat post
- **THEN** it is refused and no late user-facing success message appears

#### Scenario: Shell after revocation
- **WHEN** a replaced or stopped execution runs a shell command or desktop tool before its process group has ended
- **THEN** the command or tool is refused because the execution capability is no longer live

### Requirement: Scoped trigger management
A live execution SHALL be able to list/search, read, create, update, delete, enable/disable, preview and run its own bot's triggers through runtime tools. The server SHALL derive bot ownership from the execution capability. All writes SHALL require the observed server revision and refuse stale or repeated requests before changing state or launching work. The existing trigger service SHALL enforce schedule/event validation, time zone, minimum interval, trigger count and pending-firing cancellation. Run now SHALL start an independent execution.

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
A new execution SHALL be able to inspect other active executions, deliver a durable bounded inbox message or replace older work. Inbox delivery SHALL distinguish accepted from consumed. Replacement SHALL check an expected target revision, record supersession, revoke old mutation authority, including its shell and desktop gate, and await process cleanup. A target already completed SHALL be reported explicitly. External effects already performed SHALL not be represented as undone.

#### Scenario: Correct destination
- **WHEN** a new execution interprets “BBC Sports instead” as a correction to an active BBC News execution
- **THEN** it can stop/supersede that execution and post the corrected result without a late post from the old execution

### Requirement: Shared resources and admission
Fresh message executions SHALL not wait behind a single per-bot conversation turn. Normal concurrency SHALL be bounded with reserved coordination capacity. Every live execution SHALL be able to use the shared shell and desktop at the same time as the bot's other live executions; the server SHALL NOT grant exclusive ownership of either. Executions SHALL coordinate overlapping work through the runtime coordination tools. The execution briefing SHALL tell the agent that the desktop and browser are shared, that it must not drive them while another active execution is using them, and that it should re-check active executions with the runtime tools before taking the desktop, because the briefing is a startup snapshot. Two executions that start together MAY still race; the server SHALL NOT resolve that race with an exclusive lease. Process groups and credentials SHALL remain execution-scoped; sibling executions share the bot container and are not security-isolated from one another.

#### Scenario: Busy desktop
- **WHEN** an execution is using the desktop and a correction arrives
- **THEN** the correction execution can inspect it and stop, message or replace it, and has shell and desktop access of its own

#### Scenario: Desktop tools through the shell prefix
- **WHEN** an agent launches the desktop or browser MCP server through the bot's shell prefix and calls a tool while its execution is live
- **THEN** the call reaches the desktop, the server it wraps does not inherit the runtime token, and the same call is refused once the execution is revoked

#### Scenario: Briefing warns about the shared desktop
- **WHEN** an execution starts while another execution is active
- **THEN** its briefing warns not to drive the desktop or browser while another active execution uses them and to re-check active executions before doing so

#### Scenario: A refused command does not break later commands
- **WHEN** an execution's shell command is refused and the execution then runs further commands while its capability is live
- **THEN** those later commands run, and none fails because an earlier command stripped its runtime token

### Requirement: Durable messages and attachments
Messages SHALL have stable IDs, monotonic order, author provenance, timestamps and revisions. Edit/delete/clear SHALL act on communication records, never rewrite diagnostic transcripts or replay prior actions. Running executions SHALL observe these changes through events. Attachments posted by a bot SHALL be captured into bounded server-owned storage and remain readable after execution completion or container replacement. Tool results SHALL return attachment metadata rather than file bytes.

User messages SHALL be able to carry attachments of any file type that an authorized client uploads before posting.

**Upload.**

Each upload carries one file and returns an opaque upload token bound to that bot, the file and the name offered for it. The server SHALL determine the type from the file content alone: PNG, JPEG, GIF and WebP content is an image of that type, MP4 and WebM content is a video of that type, and any other content is stored as `application/octet-stream`, whatever type or name the client offers. It SHALL refuse an empty upload, an image larger than 2 MiB, any other file larger than 5 MiB, and any upload that would push the bot's attachment storage, staged uploads included, past its bound. Offered names SHALL be treated as display text, never as paths.

**Post.**

A post SHALL reference at most four distinct upload tokens. Its text MAY be empty when it references at least one token. The post SHALL be checked in this order:

1. The idempotency key is checked first. Repeating an earlier post with the same key and content returns that post's message, even if its tokens have since been consumed.
2. The tokens are checked. A token that is unknown, expired, consumed, bound to another bot or repeated in the same post SHALL cause the whole post to be refused, with no message created.
3. The message is persisted, and only then are its tokens consumed. A failed persist SHALL leave the tokens usable.

**Staging and expiry.**

A staged upload SHALL NOT be pruned while its token is valid. Tokens SHALL expire after a bounded staging period. Expired staged uploads SHALL be discarded when the bot's attachments are next uploaded, posted, pruned or loaded. Clearing the chat or deleting the bot SHALL discard all of its staged uploads.

#### Scenario: Screenshot survives recreation
- **WHEN** a posted screenshot's original container file disappears
- **THEN** its durable message attachment remains available to authorized clients

#### Scenario: User posts an image
- **WHEN** an authorized client uploads a PNG and posts a message referencing it
- **THEN** the user message records the attachment with its name, type and size
- **AND** the image is readable through the attachment operation after the bot's container is replaced

#### Scenario: File survives recreation
- **WHEN** a user-posted zip has been delivered to an execution and the bot's container is then replaced
- **THEN** the attachment operation still returns the zip's exact bytes

#### Scenario: User posts a zip
- **WHEN** an authorized client uploads a 3 MiB zip archive named `logs.zip` with a claimed type of `image/png` and posts a message referencing it
- **THEN** the user message records the attachment named `logs.zip` with type `application/octet-stream` and its size
- **AND** the attachment operation returns the archive's exact bytes

#### Scenario: User posts a video
- **WHEN** an authorized client uploads a 3 MiB MP4 named `clip.bin` with a claimed type of `text/plain` and posts a message referencing it
- **THEN** the user message records the attachment named `clip.bin` with type `video/mp4` and its size

#### Scenario: Unsupported or oversized upload
- **WHEN** a client uploads an empty file, a PNG over 2 MiB, or any other file over 5 MiB
- **THEN** the upload is refused with a validation error and nothing is stored

#### Scenario: Foreign, unknown or repeated token
- **WHEN** a post references a token staged for another bot, an unknown or expired token, or the same token twice
- **THEN** the post is refused, no message is created and the post's other valid tokens remain usable

#### Scenario: Retry after the response is lost
- **WHEN** a post with tokens succeeds and the client retries with the same idempotency key and content
- **THEN** the original message is returned and no second message or execution is created

#### Scenario: Same bytes under two names
- **WHEN** identical image bytes are uploaded twice with different names and both tokens are posted
- **THEN** the message records two attachments, each with its own offered name

#### Scenario: Abandoned upload
- **WHEN** a file is staged and its token expires without being posted
- **THEN** the file is discarded at the bot's next attachment upload, post, prune or load, and no longer counts toward storage

#### Scenario: Clear discards staging
- **WHEN** the chat is cleared while uploads are staged
- **THEN** those staged uploads are discarded and their tokens are refused

### Requirement: Communication UI
Chat SHALL show the bot's shared message log with paginated history, explicit pending/failure states, message controls and inline durable attachments. Each message SHALL show its own author avatar, author name and the time it was posted, so consecutive messages from one author remain distinct. Session selection SHALL open execution details without changing chat history. Raw thoughts, tools and provider output SHALL remain in execution details. New chat and conversation continuation SHALL not define ordinary messaging behavior. Schedules and events SHALL start fresh executions with the same runtime tools and communication log.

Each device SHALL remember, per bot, the last message it has read. When Chat opens with bot messages posted after that point, a labelled divider SHALL mark where they begin, and SHALL stay in place for the rest of that visit. Leaving Chat, closing or leaving the bot tab, hiding the window, or sending a message SHALL mark every loaded message read. A bot this device has never shown SHALL start with every message read.

The composer SHALL offer an attach button that opens a picker for files of any type. Files dropped onto the composer, and files pasted into it, SHALL be added the same way. The composer SHALL classify each file by its content, never by its claimed type or name. Each pending file SHALL show before sending with a remove control: PNG, JPEG, GIF or WebP content as a thumbnail, and any other file as a chip with a file icon, its name and its size. Send SHALL be enabled when the draft has text or at least one pending file. The composer SHALL refuse a fifth file, an image over 2 MiB or any other file over 5 MiB with an inline message, and leave the other pending files unchanged. Pending files SHALL be cleared once the message is posted and kept if posting fails. When the outcome of a send is unknown, a retry SHALL reuse the same idempotency key and any tokens already obtained, so the message is not duplicated. User and bot messages SHALL show image attachments inline, video attachments as inline players, and every other attachment as a file chip with its name and size. Activating a file chip SHALL save the attachment's bytes through the host's save flow; an attachment that is neither an image nor a video SHALL never be rendered or opened in the workspace.

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

#### Scenario: Attach with the button
- **WHEN** the user clicks the attach button and chooses an image
- **THEN** a thumbnail of the image appears in the composer with a remove control

#### Scenario: Attach a zip
- **WHEN** the user clicks the attach button and chooses `logs.zip`
- **THEN** a chip with a file icon, `logs.zip` and its size appears in the composer with a remove control

#### Scenario: Misleading type
- **WHEN** the user attaches a 3 MiB zip named `x.png` whose claimed type is `image/png`, and a PNG whose claimed type is empty
- **THEN** the zip is accepted and shown as a file chip, and the PNG is shown as a thumbnail under the 2 MiB image limit

#### Scenario: Drop and paste
- **WHEN** the user drops a file onto the composer or pastes a file from the clipboard
- **THEN** the file is added to the pending files, an image as a thumbnail and any other file as a chip
- **AND** pasting plain text still inserts the text into the draft

#### Scenario: Remove before sending
- **WHEN** the user removes a pending thumbnail or file chip
- **THEN** that file is not sent with the message

#### Scenario: Send image only
- **WHEN** the draft is empty and one image is pending and the user presses Enter
- **THEN** a user message with that image and no text appears in the chat log
- **AND** the composer clears its pending files

#### Scenario: Send a file
- **WHEN** the user sends a message with `logs.zip` pending
- **THEN** the user message shows a chip with `logs.zip` and its size
- **AND** activating the chip saves the archive's exact bytes through the host's save flow

#### Scenario: Active content is only downloaded
- **WHEN** a user message carries an HTML or SVG file
- **THEN** it shows as a file chip, and activating the chip saves it without rendering or opening it in the workspace

#### Scenario: Download fails
- **WHEN** reading a file attachment fails while the user activates its chip
- **THEN** the chip shows the error and the chat stays usable

#### Scenario: Too many or invalid files
- **WHEN** four files are pending and the user adds another, or adds an image over 2 MiB or another file over 5 MiB
- **THEN** the composer shows an inline message and leaves the pending files unchanged

#### Scenario: Send fails
- **WHEN** an upload or the post is refused
- **THEN** the composer shows the error and keeps the draft text and pending files

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
The runner output read SHALL accept any execution of the calling bot that has started, whether running, waiting on the user or ended. It SHALL return the stored, already-redacted runner output in slices of at most 6 KiB of text. Without a cursor it SHALL return the last slice, and its cursor SHALL continue towards earlier output. For an execution that has not ended it SHALL return only the latest slice, with no cursor, and SHALL refuse a supplied cursor as a conflict. It SHALL also return the time of the last recorded activity and the kind and status of at most the 10 latest activity entries, holding no title, command, plan text, tool input, tool output or message text. The whole response SHALL stay within the runtime response limit.

#### Scenario: Reading why an execution failed
- **WHEN** an execution reads the summary and then the runner output of a sibling execution that failed with `spawn EAGAIN`
- **THEN** the summary includes the failure reason, and the output read returns the end of the output, including the `EAGAIN` error, with a cursor for earlier output

#### Scenario: Running execution's output
- **WHEN** an execution asks for the runner output of an execution that is still running
- **THEN** it receives the latest redacted slice with no cursor, the time of the last activity, and the kind and status of the latest activity, without titles, commands, plan text, tool input, tool output or message text

#### Scenario: Cursor on a running execution

- **WHEN** an execution passes a cursor when reading a running execution's output
- **THEN** the request is refused as a conflict that tells it to read again without a cursor

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

A bot notification SHALL carry the bot's identity, the number of its unacknowledged posts, a plain-text excerpt of the latest of them of at most 280 characters, and the time that post was made. A post with attachments and no text SHALL have an excerpt saying the bot sent an image when every attachment is an image, a video when every attachment is a video, and a file otherwise. Editing an unacknowledged post SHALL update the notification to reflect the latest remaining one.

#### Scenario: Content of one post

- **WHEN** Bird posts `Build is green`
- **THEN** its notification has an unread count of 1, the excerpt `Build is green`, and the post's time

#### Scenario: An image without text

- **WHEN** Bird posts a screenshot with no text
- **THEN** its notification's excerpt says that Bird sent an image

#### Scenario: A video without text

- **WHEN** Bird posts an MP4 with no text
- **THEN** its notification's excerpt says that Bird sent a video

#### Scenario: A file without text

- **WHEN** Bird posts a zip and an image with no text
- **THEN** its notification's excerpt says that Bird sent a file

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

### Requirement: Message attachments reach the execution
An execution started by a user message with attachments SHALL receive every attachment as a file in its bot container. Image attachments SHALL also reach it as model input in the agent's native image form, not only as text references. Other attachments SHALL reach it only as files.

The attachment list SHALL be snapshotted when the execution is dispatched. If any snapshotted attachment can no longer be read when the execution starts, the execution SHALL fail with an explicit reason. It SHALL NOT start without the attachment, and the posted message SHALL remain.

Before the agent starts, the server SHALL write each attachment's exact bytes into the owning bot container. The file name is chosen by the server from the attachment's position and an extension: an image's type, or for any other file the offered name's last extension when it is 1 to 10 ASCII letters or digits, lower-cased, and `bin` otherwise. No other part of the offered name is used. Writes SHALL refuse symlinks and leave no partial file. The execution briefing SHALL list each attachment's name, type, size and container path. The execution's copies SHALL be removed when it ends; the durable attachment remains the record.

Attachments SHALL be delivered only to the execution triggered by that message. Briefings for other executions SHALL keep attachment metadata only.

#### Scenario: Claude Code bot sees a pasted screenshot
- **WHEN** the user sends a screenshot to a Claude Code bot
- **THEN** the triggered execution's first user turn contains the image as an image content block
- **AND** the briefing names the image and its container path

#### Scenario: Codex bot sees an attached image
- **WHEN** the user sends an image to a Codex bot
- **THEN** the image is written into the bot container and passed to Codex as an image input for the initial prompt

#### Scenario: Bot receives a zip
- **WHEN** the user sends `logs.zip` to a Claude Code or Codex bot
- **THEN** the archive's exact bytes are written into the bot container with a `.zip` file name chosen by the server
- **AND** the briefing names `logs.zip`, its type, size and container path
- **AND** the agent receives no image input for it

#### Scenario: Unsafe extension
- **WHEN** the user sends a file named `notes.../../x y`
- **THEN** its container file name uses the `bin` extension and lies directly in the execution's attachment directory

#### Scenario: Copy fails part-way
- **WHEN** a message carries an image and a zip, the image copies into the container and the zip copy fails
- **THEN** the execution fails with a reason saying the attached files could not be copied, does not start the agent, and the execution's attachment directory is removed

#### Scenario: File deleted before start
- **WHEN** a queued message carrying a zip has its attachment removed by clearing the chat before its execution starts
- **THEN** the execution does not run without the file and reports why

#### Scenario: Image deleted before start
- **WHEN** a queued image message's attachment is removed by clearing the chat before its execution starts
- **THEN** the execution does not run without the image and reports why

#### Scenario: Copies are removed
- **WHEN** an execution that received attachments completes, fails or is stopped
- **THEN** its container copies are removed and the message's durable attachments remain readable

#### Scenario: Later execution
- **WHEN** a schedule starts an execution after a message with attachments was posted
- **THEN** its briefing shows the message's attachment count and metadata, and no attachment is attached to its prompt or copied for it

### Requirement: Bots attach files to their posts
`chat_post` SHALL accept up to four attachments, each a regular file under `/tmp` or `/home/bot` in the bot's own running container. The type SHALL come from the file's content alone. An image SHALL be at most 2 MiB and any other file at most 5 MiB. The `chat_post` description and the execution briefing SHALL state that bots can attach files and videos, with these limits.

#### Scenario: Bot posts an MP4
- **WHEN** a bot calls `chat_post` with an 833 KB MP4 at `/home/bot/out/clip.mp4`
- **THEN** the message records the attachment with type `video/mp4` and its size
- **AND** the tool result returns attachment metadata and no file bytes

#### Scenario: Bot posts another file type
- **WHEN** a bot calls `chat_post` with a 3 MiB zip
- **THEN** the message records it with type `application/octet-stream` and Chat shows it as a file chip

### Requirement: Bot attachment refusals state the limit
A size refusal SHALL name the file and state its size, its type and the limit that applied. An empty file SHALL be refused by name. Path, symlink, missing-file, container and storage refusals SHALL state that cause and SHALL NOT report facts about a file the server did not safely open. Any refused attachment SHALL refuse the whole post with no message created.

#### Scenario: One bad attachment among good ones
- **WHEN** a bot posts a valid PNG and an empty file together
- **THEN** the post is refused naming the empty file, and no message is created

#### Scenario: Oversized video
- **WHEN** a bot attaches a 6.1 MiB MP4 named `video.mp4`
- **THEN** the post is refused with an error stating that `video.mp4` is 6.1 MiB, its type is `video/mp4`, and non-image attachments are limited to 5 MiB

#### Scenario: Large animated GIF
- **WHEN** a bot attaches a 3 MiB GIF
- **THEN** the post is refused with an error stating its size, its type and the 2 MiB image limit, and suggesting MP4 or WebM

### Requirement: Bot attachment reads stay inside the container
The server SHALL read a bot attachment only from that bot's own running container, without following a symlink at any path component. It SHALL refuse a directory, device, pipe, socket or path outside `/tmp` and `/home/bot`.

#### Scenario: Symlink or special file
- **WHEN** a bot attaches a symlink, a path through a symlinked directory, a directory or a pipe
- **THEN** the post is refused and nothing outside the regular file is read

### Requirement: Video types come from a bounded content check
The type SHALL be decided from at most the first 64 bytes of content, so a file gets the same type whether it is accepted or refused for size. Truncated or malformed content SHALL be `application/octet-stream`. A recognised type SHALL NOT imply the content is playable.

#### Scenario: Recognised MP4 brand
- **WHEN** content starts with an `ftyp` box whose major brand is `isom`, `iso2` to `iso6`, `mp41`, `mp42`, `avc1` or `M4V `
- **THEN** its type is `video/mp4`

#### Scenario: Recognised WebM header
- **WHEN** content starts with an EBML header whose DocType, within the first 64 bytes, is `webm`
- **THEN** its type is `video/webm`

#### Scenario: Similar containers stay opaque
- **WHEN** a file is HEIC, AVIF or Matroska, or has a truncated video header
- **THEN** its type is `application/octet-stream` and it shows as a file chip

#### Scenario: Oversized file keeps its type
- **WHEN** a 6 MiB WebM is refused
- **THEN** the refusal reports `video/webm`, the type the same content would receive at an allowed size

### Requirement: Inline video attachments
Chat SHALL render an attachment whose server-derived type is `video/mp4` or `video/webm` as an inline player with controls, looping, muted and inline playback, and SHALL NOT autoplay it. The message SHALL keep a download action for the video. The workspace SHALL load media only from its own origin and from `blob:` URLs.

#### Scenario: Video plays in Chat
- **WHEN** a bot posts a WebM
- **THEN** its message shows a player with controls that is looped, muted and inline, and does not start on its own
- **AND** the message offers a download of the video's exact bytes

#### Scenario: Misnamed file is not played
- **WHEN** a message carries a text file named `clip.mp4`
- **THEN** it shows as a file chip and no player is created

### Requirement: Video attachments load on demand
The player SHALL load the attachment's bytes through the authorized attachment operation only when it nears the viewport. A paused player far from the viewport SHALL release its loaded bytes and load them again when it returns. A load that finishes after the player is gone SHALL be discarded. If the video cannot be loaded or decoded, the message SHALL show its download action without a broken player.

#### Scenario: Video scrolled far away
- **WHEN** a paused video that has loaded is scrolled far from the viewport
- **THEN** its loaded bytes are released, and it loads again when scrolled back

#### Scenario: Video outside the viewport
- **WHEN** Chat history contains a video far above the visible messages
- **THEN** its bytes are not requested until it nears the viewport

#### Scenario: Video cannot be decoded
- **WHEN** a video attachment fails to load or decode
- **THEN** the message shows the download action and the chat stays usable

### Requirement: Video is not model input
Video attachments SHALL reach an execution only as files and SHALL NOT be sent to the model as image input.

#### Scenario: Video is not model input
- **WHEN** a user sends a bot an MP4
- **THEN** the execution receives it as a container file and the agent receives no image input for it
