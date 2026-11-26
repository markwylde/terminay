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

Each upload carries one file and returns an opaque upload token bound to that bot, the file and the name offered for it. The server SHALL determine the type from the file content alone: PNG, JPEG, GIF and WebP content is an image of that type, MP4 and WebM content is a video of that type, MP3, WAV, Ogg, FLAC and M4A content is audio of the type given in Audio types come from a bounded content check, and any other content is stored as `application/octet-stream`, whatever type or name the client offers. It SHALL refuse an empty upload, an image larger than 2 MiB, any other file larger than 5 MiB, and any upload that would push the bot's attachment storage, staged uploads included, past its bound. Offered names SHALL be treated as display text, never as paths.

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

#### Scenario: User posts audio
- **WHEN** an authorized client uploads a 4 MiB MP3 named `song.dat` with a claimed type of `application/zip` and posts a message referencing it
- **THEN** the user message records the attachment named `song.dat` with type `audio/mpeg` and its size

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
Chat SHALL show the bot's shared message log with paginated history, explicit pending/failure states, message controls and inline durable attachments. Each message SHALL show its own author avatar, author name and the time it was posted, so consecutive messages from one author remain distinct. Session selection SHALL open execution details without changing chat history. Raw thoughts, provider output and provider-reported tool use SHALL remain in execution details; the only tool use Chat shows is the action entries the server records (see Terminay actions in the message log). New chat and conversation continuation SHALL not define ordinary messaging behavior. Schedules and events SHALL start fresh executions with the same runtime tools and communication log.

Each device SHALL remember, per bot, the last message it has read. When Chat opens with bot messages posted after that point, a labelled divider SHALL mark where they begin, and SHALL stay in place for the rest of that visit. Leaving Chat, closing or leaving the bot tab, hiding the window, or sending a message SHALL mark every loaded message read. A bot this device has never shown SHALL start with every message read.

The composer SHALL offer an attach button that opens a picker for files of any type. Files dropped onto the composer, and files pasted into it, SHALL be added the same way. The composer SHALL classify each file by its content, never by its claimed type or name. Each pending file SHALL show before sending with a remove control: PNG, JPEG, GIF or WebP content as a thumbnail, and any other file as a chip with a file icon, its name and its size. Send SHALL be enabled when the draft has text or at least one pending file. The composer SHALL refuse a fifth file, an image over 2 MiB or any other file over 5 MiB with an inline message, and leave the other pending files unchanged. Pending files SHALL be cleared once the message is posted and kept if posting fails. When the outcome of a send is unknown, a retry SHALL reuse the same idempotency key and any tokens already obtained, so the message is not duplicated. User and bot messages SHALL show image attachments inline, video attachments as inline players, audio attachments as inline mini players, and every other attachment as a file chip with its name and size. Activating a file chip or an audio player's download button SHALL save the attachment's bytes through the host's save flow; an attachment that is not an image, a video or audio SHALL never be rendered or opened in the workspace.

#### Scenario: Read execution details
- **WHEN** a user selects a recent execution
- **THEN** its diagnostics open separately and the shared chat log remains intact

#### Scenario: Provider tool use stays in details
- **WHEN** an execution runs a shell command through its provider's own shell tool
- **THEN** Chat shows no row for it, and the call appears in that execution's details

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
A briefing SHALL list up to 5 of the bot's executions that ended as failed or timed out in the last 24 hours. Each entry SHALL give the execution's compact origin and its failure reason cut to 256 bytes. When the execution had a startup failure, the entry SHALL also give its stage, whether it was temporary, and how many attempts were made. When the execution reported an outcome, the entry SHALL give its disposition. The briefing SHALL also list up to 5 of the bot's triggers whose condition health is failed or blocked, or that are waiting for the user. Each such trigger SHALL have its health error or blocker reason cut to 256 bytes. The briefing SHALL tell the agent that a temporary startup failure is usually outside its control and needs no action unless it keeps recurring.

#### Scenario: Briefing after failures
- **WHEN** a chat execution starts an hour after a trigger execution failed and while that trigger's condition check is failing
- **THEN** its briefing lists the failed execution with its reason and the trigger with its health error

#### Scenario: Briefing after an overloaded host
- **WHEN** an execution starts after a trigger execution failed four temporary startup attempts at the adapter check
- **THEN** its briefing lists that execution as a temporary startup failure at the adapter check with four attempts

#### Scenario: Briefing while a trigger waits for the user
- **WHEN** an execution starts while one of the bot's triggers is waiting for the user
- **THEN** its briefing lists that trigger with its blocker reason

### Requirement: Briefings trim in a fixed order
When a briefing exceeds its budget, it SHALL drop entries in this order until it fits: the thread's latest replies, then the root excerpt cut to 256 bytes, then older recent messages, then unhealthy triggers, then failed executions, then other active executions. Trigger identity and content, and the thread's root ID, SHALL always be kept.

#### Scenario: Worst-case failure text
- **WHEN** ten failed executions and ten failing triggers all have 1 KiB reasons of multibyte and JSON-escaped characters
- **THEN** the briefing stays within its budget and lists at most five of each, cut on UTF-8 boundaries

#### Scenario: Thread context trims first
- **WHEN** a reply execution starts in a thread whose latest replies and root are long, with ten long recent messages
- **THEN** the briefing drops the thread's latest replies and cuts the root excerpt before dropping any recent message, and keeps the root ID

### Requirement: Execution failure details
Execution list results SHALL carry a compact origin: its kind, any trigger ID and name, and for a failure origin the number of failures. They SHALL also carry the failure reason cut to 256 bytes, the structured failure cause, and the startup failure's stage, temporary flag and attempt count when there is one. A single execution read SHALL add the reason cut to 1 KiB, the reported outcome with its reason and action, and for a failure origin its listed failures, all within the 8 KiB response budget.

#### Scenario: Failure origin detail
- **WHEN** an execution reads a failure execution that lists 20 failures with 1 KiB reasons
- **THEN** the response stays within 8 KiB and says how many failures were left out

#### Scenario: Startup failure detail
- **WHEN** an execution reads a sibling that failed three temporary startup attempts at the relay stage
- **THEN** the result names the relay stage, marks it temporary and gives three attempts

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

A bot notification SHALL carry the bot's identity, the number of its unacknowledged posts, a plain-text excerpt of the latest of them of at most 280 characters, and the time that post was made. A post with attachments and no text SHALL have an excerpt saying the bot sent an image when every attachment is an image, a video when every attachment is a video, an audio file when every attachment is audio, and a file otherwise. Editing an unacknowledged post SHALL update the notification to reflect the latest remaining one.

#### Scenario: Content of one post

- **WHEN** Bird posts `Build is green`
- **THEN** its notification has an unread count of 1, the excerpt `Build is green`, and the post's time

#### Scenario: An image without text

- **WHEN** Bird posts a screenshot with no text
- **THEN** its notification's excerpt says that Bird sent an image

#### Scenario: A video without text

- **WHEN** Bird posts an MP4 with no text
- **THEN** its notification's excerpt says that Bird sent a video

#### Scenario: Audio without text

- **WHEN** Bird posts two MP3s with no text
- **THEN** its notification's excerpt says that Bird sent an audio file

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
`chat_post` SHALL accept up to four attachments, each a regular file under `/tmp` or `/home/bot` in the bot's own running container. The type SHALL come from the file's content alone. An image SHALL be at most 2 MiB and any other file at most 5 MiB. The `chat_post` description and the execution briefing SHALL state that bots can attach files, videos and audio, that video and audio play inline in Chat, and these limits.

#### Scenario: Bot posts an MP4
- **WHEN** a bot calls `chat_post` with an 833 KB MP4 at `/home/bot/out/clip.mp4`
- **THEN** the message records the attachment with type `video/mp4` and its size
- **AND** the tool result returns attachment metadata and no file bytes

#### Scenario: Bot posts a WAV
- **WHEN** a bot calls `chat_post` with a 2 MiB WAV at `/tmp/take.wav`
- **THEN** the message records the attachment with type `audio/wav` and its size, and Chat shows it as an audio player

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
Chat SHALL render an attachment whose server-derived type is `video/mp4` or `video/webm` as an inline player with controls, looping, muted and inline playback, and SHALL NOT autoplay it. The player SHALL show the whole video at its own aspect ratio, no wider than the message and no taller than 70% of the window height. The message SHALL keep a download action for the video. The workspace SHALL load media only from its own origin and from `blob:` URLs.

#### Scenario: Video plays in Chat
- **WHEN** a bot posts a WebM
- **THEN** its message shows a player with controls that is looped, muted and inline, and does not start on its own
- **AND** the message offers a download of the video's exact bytes

#### Scenario: Tall video is shown whole
- **WHEN** a bot posts a video that is twice as tall as it is wide
- **THEN** its player has that same shape and no part of the picture is cut off

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

### Requirement: Start-failure warning in Chat
When a user message cannot start its execution, the message SHALL keep the failure and its reason. Chat SHALL show a warning for that message with the reason and two controls, Dismiss and Retry. Chat SHALL show the warning only while the failure is not dismissed and no later user message in the log has started an execution. Deleting the message or clearing Chat SHALL remove its warning.

#### Scenario: A later message starts
- **WHEN** a message fails to start, and the user then sends another message that starts an execution
- **THEN** Chat no longer shows the first message's warning

#### Scenario: Several unresolved failures
- **WHEN** two messages fail to start and no later message has started
- **THEN** Chat shows a warning for each of them

#### Scenario: Deleting the failed message
- **WHEN** the user deletes a message whose start failed
- **THEN** its warning disappears

### Requirement: Dismissing a start failure
Dismiss SHALL be recorded on the message on the server, so the warning stays hidden on every client and after reloads and restarts. Every attached client SHALL observe the dismissal through message events.

#### Scenario: Dismiss
- **WHEN** the user dismisses a message's start-failure warning
- **THEN** the warning disappears, and stays hidden after Chat reloads, after a server restart and on another client

#### Scenario: Dismissed failure cannot be retried
- **WHEN** a client retries a message whose failure was dismissed
- **THEN** the request is refused as a conflict and no execution starts

### Requirement: Retrying a start failure
Retry SHALL start a fresh execution linked to the same message, without posting another message. Like a post, it SHALL act for the window of the client that asked. The message SHALL show as pending while it starts, then as started, or as failed with a new reason.

#### Scenario: Retry succeeds
- **WHEN** the user retries a message whose start failed, and the execution starts
- **THEN** the warning disappears, no new message is posted, and the new execution is linked to that message

#### Scenario: Retry fails again
- **WHEN** the user retries a message and the execution still cannot start
- **THEN** the warning stays, showing the new reason

#### Scenario: Restart during a retry
- **WHEN** the server restarts while a retried message is pending
- **THEN** the message becomes started if its retried execution exists, and failed with a reason otherwise, and no further execution starts on its own

### Requirement: Retry and Dismiss are guarded
Retry and Dismiss SHALL name the message's revision and the dispatch attempt the client observed. Only a message whose start failed and was not dismissed, at that revision and attempt, SHALL be retried or dismissed. Any other request SHALL be refused as a conflict without changing the message. Each accepted retry SHALL start a new attempt, so at most one retry is accepted per failure.

#### Scenario: Concurrent retries
- **WHEN** two retry requests naming the same failed attempt arrive together
- **THEN** exactly one is accepted and makes one start attempt, and the other is refused as a conflict

#### Scenario: Late retry after a failed retry
- **WHEN** a retry naming an earlier attempt arrives after a later attempt has already failed
- **THEN** it is refused as a conflict and no execution starts

#### Scenario: Message edited elsewhere
- **WHEN** a client retries a failed message whose text another client has since edited
- **THEN** the retry is refused as a conflict, and the client shows the current text

#### Scenario: Retry a message that did not fail
- **WHEN** a client asks to retry or dismiss a message that started, is pending, or was posted by the bot
- **THEN** the request is refused as a conflict and the message is unchanged

### Requirement: Quote in the message menu

Every chat message whose text is not blank, whether the user or the bot wrote it, SHALL offer Quote as the first item of its message menu, above Edit message and Delete message. The menu SHALL open on right-click and, when the message has focus, on the context-menu key or Shift+F10. A menu opened from the keyboard SHALL appear at the message with its first item focused, SHALL be operable with Up, Down, Home, End and Enter, and SHALL return focus to the message when Escape closes it. A message whose text is empty or only whitespace SHALL NOT offer Quote.

#### Scenario: Message with only an attachment
- **WHEN** the user opens the menu on a message that has an image and no text
- **THEN** the menu offers Edit message and Delete message but not Quote

#### Scenario: Quote from the keyboard
- **WHEN** a message has focus and the user presses Shift+F10
- **THEN** the menu appears at the message with Quote focused
- **AND** pressing Enter inserts the quote and focuses the composer

#### Scenario: Dismiss from the keyboard
- **WHEN** a keyboard-opened message menu is open and the user presses Escape
- **THEN** the menu closes and the message has focus again

### Requirement: Quote text

Quote SHALL quote the message's stored text, its Markdown source, unless the user has a non-empty text selection lying wholly inside that message's body when the menu opens; then only the selected text, as displayed, SHALL be quoted. A selection outside the message, or spanning it and another message, SHALL be ignored. Choosing a quote SHALL NOT change what Edit message edits.

The quoted text SHALL have CRLF and CR line endings turned into LF and blank lines at its start and end removed; other lines SHALL be kept as they are, trailing spaces included. Each line SHALL then be prefixed with `> `, an empty line written as `>`, and the quote followed by one blank line.

Quoted text longer than 2,000 characters, counted as Unicode code points, SHALL be cut to at most 2,000 code points, at the last line break when one falls in the second half of the cut, and never inside a code point. When the cut leaves a fenced code block open, a closing fence SHALL be added. The quote SHALL then end with a `>` line and a `> …` line.

#### Scenario: Multi-line bot reply
- **WHEN** the user quotes the bot message "Build passed.\r\n\r\nDeployed to staging.\n"
- **THEN** the quote is "> Build passed.\n>\n> Deployed to staging.\n\n"

#### Scenario: Markdown is kept
- **WHEN** the user quotes a message containing a fenced code block and a list
- **THEN** every line of the fence and the list appears in the quote prefixed with `> `, unchanged otherwise

#### Scenario: Quote a selection
- **WHEN** the user selects one sentence inside a long bot message and chooses Quote on that message
- **THEN** only that sentence is quoted
- **AND** choosing Edit message on the same message still edits its full text

#### Scenario: Selection elsewhere
- **WHEN** the user has text selected in another message and chooses Quote on this message
- **THEN** the whole of this message is quoted

#### Scenario: Long message cut at a line break
- **WHEN** the user quotes a message of 10,000 characters made of 80-character lines
- **THEN** the quote holds the message's first whole lines up to 2,000 characters and ends with ">\n> …\n\n"

#### Scenario: Long message cut inside a code block
- **WHEN** the 2,000-character cut falls inside a fenced code block
- **THEN** the quote closes the fence before its `> …` line

### Requirement: Quote into the composer

Choosing Quote SHALL append the quote to the composer's draft and SHALL NOT change the existing draft text or the pending files. An empty draft SHALL become the quote. A draft that ends in a blank line SHALL be followed directly by the quote; one that ends in a single line break SHALL get one more; any other draft, whitespace-only drafts included, SHALL get a blank line before the quote. The composer SHALL then have focus with the caret at the end of the draft. Quoting SHALL NOT send anything.

#### Scenario: Quote into an empty composer
- **WHEN** the composer is empty and the user quotes the bot message "Ship it"
- **THEN** the draft is "> Ship it\n\n"
- **AND** the composer has focus with the caret at the end
- **AND** no message is sent

#### Scenario: Quote the user's own message after a draft
- **WHEN** the draft is "About this:" and the user quotes their own message "Ship it"
- **THEN** the draft is "About this:\n\n> Ship it\n\n" and the caret is at the end

#### Scenario: Draft ending in a line break
- **WHEN** the draft is "Two things:\n" and the user quotes "A"
- **THEN** the draft is "Two things:\n\n> A\n\n"

#### Scenario: Two quotes in a row
- **WHEN** the user quotes "A" and then quotes "B"
- **THEN** the draft is "> A\n\n> B\n\n"

#### Scenario: Pending files are kept
- **WHEN** an image is pending in the composer and the user quotes a message
- **THEN** the image is still pending

### Requirement: Terminay actions in the message log
When a live execution of a bot makes a recorded Terminay call, the server SHALL record one action entry in that bot's message log once the tool's handler has finished, whether the call succeeded or failed. The recorded calls SHALL be exactly these, and no others:

- terminals: `open_terminal`, `split_terminal`, `write_terminal`, `run_command`, `close_terminal`, `focus_terminal`, `rename_terminal`, `update_terminal`, `move_terminal_to_project`, `run_macro`, `cancel_macro`;
- tabs, folders and files: `focus_tab`, `move_tab`, `resize_pane`, `arrange_tabs`, `close_tab`, `focus_home`, `select_folder`, `create_folder`, `rename_folder`, `delete_folder`, `reorder_folders`, `move_tab_to_folder`, `open_file`;
- projects and windows: `create_project`, `update_project`, `move_project`, `close_project`, `focus_project`, `open_workspace_window`, `rename_workspace_window`, `close_workspace_window`;
- workflows: `create_workflow`, `update_workflow_step`, `create_workflow_template`, `update_workflow_template`, `delete_workflow_template`;
- automations: `create_automation`, `update_automation`, `delete_automation`, `set_automation_enabled`, `run_automation`, `stop_automation_run`, `remove_automation_run`, `prune_automation_runs`, `dismiss_missed_runs`;
- settings: `update_settings`, `save_shell_profile`, `delete_shell_profile`, `reorder_shell_profiles`, `set_default_shell_profile`;
- the bot's runtime trigger tools `triggers_create`, `triggers_update`, `triggers_delete`, `triggers_enable` and `triggers_run`.

A call refused before its operation is dispatched, because the capability is invalid, revoked or names no execution of that bot, SHALL NOT be recorded. An action whose message log was cleared while the call ran SHALL NOT be recorded.

#### Scenario: Bot creates a project
- **WHEN** an execution of a bot with Terminay MCP access calls `create_project` named "api" and it succeeds
- **THEN** the bot's log gains one action entry reading Created the project “api”, with outcome done and the new project as its link target

#### Scenario: Read calls are not recorded
- **WHEN** an execution calls `list_terminals`, `read_terminal`, `get_workflow` and `wait_for_idle`
- **THEN** the bot's log gains no entry

#### Scenario: Failed call
- **WHEN** an execution calls `create_automation` while Full Automation Management is Never Allow
- **THEN** the bot's log gains one action entry with outcome failed and a reason naming the permission refusal

#### Scenario: Bot creates a trigger
- **WHEN** an execution creates a trigger through its runtime trigger tools
- **THEN** the bot's log gains one action entry with that trigger as its link target

#### Scenario: Revoked capability
- **WHEN** a bot's Terminay MCP access is turned off and its running execution's next Terminay MCP call fails as revoked
- **THEN** the bot's log gains no entry for that call

#### Scenario: Chat cleared during a call
- **WHEN** the user clears a bot's chat while one of its `run_command` calls is still running
- **THEN** the cleared log gains no entry for that call

### Requirement: Action entry content
An action entry SHALL be authored by the bot, linked to its execution, and SHALL carry the tool's name, a description in Terminay's own words, its outcome, a failure reason for a failed call, a count, and a link target when the call created or addressed one. The description SHALL be in the past tense when the call was done and SHALL start "Couldn't" when it failed. The description and reason SHALL be redacted like the bot's own posts before they are cut and stored; when redaction fails, nothing SHALL be recorded. The description SHALL be at most 512 bytes and SHALL name terminals and projects by their display names. It SHALL quote only what the agent asked for, cut to 80 characters for a command and 60 for a name, and SHALL NEVER contain terminal output, setting values, file contents or a tool's result. The reason SHALL be at most 200 bytes, taken from the error code and message the tool returned.

#### Scenario: Run command describes the command, not its output
- **WHEN** an execution calls `run_command` with `npm test` in the terminal titled "api"
- **THEN** the action entry reads Ran `npm test` in the terminal “api”, links to that terminal, and contains none of the command's output

#### Scenario: Secret in a command
- **WHEN** an execution runs a command containing a value Terminay injected into the bot as a secret
- **THEN** the action entry shows that value redacted

### Requirement: Action link targets
A link target SHALL name a project, a terminal with its project, a terminal's workflow, an automation, a workflow template, one of the bot's own triggers, or Settings, by server ID. The server SHALL resolve it from the terminal or project the call addressed and from the call's result, never from the bot's text. A terminal target SHALL name the terminal by its session and by the project it is in once the call has finished. A call that closed or deleted its target, or that failed without addressing an existing one, SHALL carry no link target.

#### Scenario: Moved terminal
- **WHEN** an execution moves the terminal titled "api" to the project "web"
- **THEN** the action entry links to that terminal in "web"

#### Scenario: Failed trigger change names an unknown trigger
- **WHEN** an execution's `triggers_update` fails because the trigger ID it gave is not one of the bot's triggers
- **THEN** the failed action entry has no link target

### Requirement: Folding repeated actions
When the newest entry of the log is an action entry from the same execution with the same tool, description, outcome, reason and link target, the server SHALL fold the new action into it, increasing its count and revision, instead of adding an entry. The folded entry SHALL keep its place in the log.

#### Scenario: Repeated typing folds
- **WHEN** an execution calls `write_terminal` five times in a row on the terminal titled "api" and each call succeeds
- **THEN** the log holds one action entry for it with a count of five

#### Scenario: Different commands do not fold
- **WHEN** an execution runs `npm test` and then `npm run build` in the same terminal
- **THEN** the log holds two action entries

### Requirement: Action entry storage
Recording SHALL NOT delay or change the result of the call it records, and a failure to record SHALL NOT fail the call. A bot's log SHALL hold at most 2,000 action entries; recording one beyond that SHALL remove the oldest action entries, and never a message. Action entries SHALL NOT count against the history limit that refuses new messages.

#### Scenario: Busy bot
- **WHEN** a bot whose log holds 2,000 action entries and 50 messages records another action
- **THEN** its oldest action entry is removed, every message remains, and the user can still post

### Requirement: Action entries are not posts
An action entry SHALL NOT raise or change a bot notification, SHALL NOT count as an unacknowledged post or an unread message, and SHALL NOT start an execution. It SHALL be refused by message edit and delete, and SHALL be removed by Clear chat. Execution briefings SHALL leave action entries out of their recent message excerpts and message counts. Runtime message list, search and get SHALL return action entries marked as actions, with their description as text. A client SHALL NOT show an entry whose action data is malformed.

#### Scenario: No notification
- **WHEN** a bot whose posts are all acknowledged records three action entries and posts nothing
- **THEN** no bot notification is raised and Chat shows no unread divider when opened

#### Scenario: Pending notification unchanged
- **WHEN** a bot has one unacknowledged post with a notification and then records two action entries
- **THEN** the notification still counts one post and shows that post

#### Scenario: Edit refused
- **WHEN** a client asks to edit or delete an action entry
- **THEN** the request is refused and the entry is unchanged

#### Scenario: Clear chat
- **WHEN** the user clears a bot's chat
- **THEN** its action entries are removed with its messages

### Requirement: Action rows in Chat
Chat SHALL show each action entry at its place in the log as one compact row, without an avatar or author header, aligned with message text and set in smaller, muted type than a message. A row SHALL show an icon for its link target's kind, the description, a done or failed mark, a ×N count when it holds more than one action, and the time on hover. A failed row SHALL show its reason. A row SHALL offer no message menu.

Consecutive action rows SHALL be shown as one tight group. A group of more than three rows SHALL show its latest three and a control naming how many earlier actions are hidden, which shows them all. A group the user expanded SHALL stay expanded as rows arrive or fold into it. The unread divider SHALL never sit above an action row.

#### Scenario: Long run of actions
- **WHEN** a bot records six action entries in a row between two messages
- **THEN** Chat shows one group with the latest three rows and a control saying 3 earlier actions, and activating it shows all six

#### Scenario: Failed row
- **WHEN** Chat shows an action entry whose outcome is failed
- **THEN** its row shows a failed mark and the reason

#### Scenario: Action reaches Chat
- **WHEN** a bot execution's `open_terminal` call succeeds while its Chat is open
- **THEN** a row for it appears without reloading Chat

### Requirement: Action links
A row with a link target SHALL offer one link named for the kind: Open project, Open terminal, Open workflow, Open automation, Open workflow template, Open triggers or Open settings. Activating it SHALL reveal the target on the bot's server through the workspace's existing navigation, the same way choosing it elsewhere in the workspace does. A project or terminal SHALL be revealed as Tabs reveals it, a terminal's workflow by revealing its terminal, an automation in Automations, a workflow template or Settings in Settings, and a trigger by opening the bot's Configure Triggers tab.

When the window holds the inventory the target belongs to (the projects and terminals of the server it shows) and that inventory no longer has the target, activating the link SHALL say so in the row and change nothing else. An automation or workflow template is opened on its own page, which says when it no longer exists. A terminal on a server whose panels the window does not hold SHALL be revealed by revealing its project, as the dashboard does for such a server's agents. When the target lives in Settings and the window shows a different server than the bot's, the row SHALL say it is not available from this window.

#### Scenario: Open the created terminal
- **WHEN** Chat shows a done action row for `open_terminal` and the user activates Open terminal
- **THEN** the workspace reveals that terminal as choosing it in Tabs does

#### Scenario: Target gone
- **WHEN** the user activates Open project on a row whose project has since been closed
- **THEN** the row says the project no longer exists and the view does not change

#### Scenario: Open triggers
- **WHEN** the user activates Open triggers on a row for `triggers_create`
- **THEN** the bot's Configure view opens on its Triggers tab

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
- **WHEN** the panel for M shows older replies loaded with "Load older replies" and a reply is deleted on another device
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

### Requirement: Outcome reporting tool

The runtime tools SHALL include `outcome_report`, which a live execution uses to report its judged outcome as specified by bot-execution-resilience. It SHALL be bound to the calling execution and bot like every runtime tool. It SHALL NOT need the shell work lease. It SHALL accept an idempotency key, so that a retried report does not post a second chat message, and SHALL take the observed trigger revision as the trigger tools do. A revoked or ended execution SHALL NOT report an outcome. A briefing SHALL tell the agent when to use each disposition: `outside-control` for failures it cannot act on, `needs-human` only when it cannot continue without a person, and `fixed` after it repaired its own trigger, condition or script.

#### Scenario: Retried report

- **WHEN** an execution sends `outcome_report` with `needs-human` twice with the same idempotency key
- **THEN** one chat message is posted and the second call returns the first result

#### Scenario: Revoked execution

- **WHEN** a stopped execution sends `outcome_report`
- **THEN** it is refused and nothing is stored or posted

### Requirement: Audio types come from a bounded content check
Audio SHALL be recognised from at most the first 64 bytes of content, by the same bounded check as video, so a file gets the same type whether it is accepted or refused for size. A format's header SHALL be complete and well formed within those bytes to be recognised; truncated, malformed or unrecognised content SHALL be `application/octet-stream`. Recognition SHALL NOT imply the payload after the header decodes.

#### Scenario: MP3 with an ID3 tag
- **WHEN** content starts with a complete 10-byte ID3v2 header of major version 2, 3 or 4, a minor version other than `0xFF`, no flag bit that version reserves, and four size bytes each below `0x80`
- **THEN** its type is `audio/mpeg`

#### Scenario: Bare MP3 frame
- **WHEN** content starts with a 4-byte MPEG Layer III frame header with 11 sync bits, a version that is not reserved, a bitrate index from 1 to 14 and a sample-rate index from 0 to 2
- **THEN** its type is `audio/mpeg`

#### Scenario: WAV, FLAC and M4A
- **WHEN** content starts with `RIFF`, four size bytes and `WAVE`; or with `fLaC`; or with an `ftyp` box whose major brand is `M4A `
- **THEN** its type is respectively `audio/wav`, `audio/flac` or `audio/mp4`

#### Scenario: Ogg Vorbis and Opus
- **WHEN** content starts with an `OggS` page of version 0 that begins a stream, whose segment table and first packet start lie within the first 64 bytes, and whose first packet, of the length its lacing values declare, is at least 30 bytes and starts with `\x01vorbis` or at least 19 bytes and starts with `OpusHead`
- **THEN** its type is `audio/ogg`

#### Scenario: Look-alikes stay opaque
- **WHEN** content is an Ogg page carrying Theora video, a `RIFF` file that is neither `WAVE` nor WebP, an ID3 header with an unknown version, a reserved flag bit set or a size byte of `0x80` or more, an Ogg page whose first packet is empty or shorter than its codec header, or a frame header with a reserved version, layer, bitrate or sample rate
- **THEN** its type is `application/octet-stream` and it shows as a file chip

#### Scenario: Truncated audio headers stay opaque
- **WHEN** content is only `ID3\x04\x00`, `RIFF` with no form type, `OggS` cut before its first packet, `fLa`, or the first two bytes of a frame header
- **THEN** its type is `application/octet-stream`

#### Scenario: Oversized audio keeps its type
- **WHEN** a bot attaches a 7 MiB FLAC
- **THEN** the post is refused with an error stating its size, the type `audio/flac` and the 5 MiB limit for non-image attachments

### Requirement: Inline audio attachments
Chat SHALL render an attachment whose recorded type is `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/flac` or `audio/mp4` as a compact mini player: a first line with the attachment's name, size and a download button, and one control row with a play/pause button, a seek bar and the elapsed and total time. The player SHALL be given only a `blob:` URL created from bytes whose type, as returned by the attachment operation, is the same audio type. The download button SHALL save the attachment's exact bytes through the host's save flow.

#### Scenario: Audio plays in Chat
- **WHEN** a user posts a WAV and then presses its play button
- **THEN** the clip plays, the button becomes a pause button and the elapsed time advances
- **AND** the player shows the clip's total time

#### Scenario: Seek
- **WHEN** the user moves the seek bar of a loaded clip to its midpoint
- **THEN** the playback position and the elapsed time move to about half the total time

#### Scenario: Download audio
- **WHEN** the user activates an audio player's download button, whether or not its bytes have loaded for playback
- **THEN** the attachment's exact bytes are saved through the host's save flow under its name
- **AND** if the save fails, the player shows the error and stays usable

#### Scenario: Misnamed file is not played as audio
- **WHEN** a message carries a text file named `song.mp3`
- **THEN** it shows as a file chip and no audio player is created

#### Scenario: Recorded type disagrees with the bytes
- **WHEN** an attachment recorded as `audio/mpeg` is returned by the attachment operation as `application/octet-stream`
- **THEN** no audio element receives its bytes and the message shows its file chip

### Requirement: Audio player behaviour
An audio player SHALL NOT autoplay, loop or start muted. Before the total time is known it SHALL show the elapsed time with `--:--` as the total and keep the seek bar disabled. When a clip plays to its end it SHALL return to the paused state at the start. If starting playback is refused, the player SHALL stay paused and usable.

#### Scenario: Duration not yet known
- **WHEN** a clip's bytes are loading or its metadata has not been read
- **THEN** the player shows `0:00 / --:--` and its seek bar is disabled

#### Scenario: Clip ends
- **WHEN** a playing clip reaches its end
- **THEN** its button shows play and its elapsed time returns to `0:00`

#### Scenario: Play refused
- **WHEN** the media element refuses to start playback
- **THEN** the player shows play and the user can try again

### Requirement: Audio plays one clip at a time and only while shown
Starting one audio player SHALL pause any other audio player playing in the same workspace window, including one in a thread panel or another bot's Chat. A playing player SHALL pause when it is no longer displayed, such as when the user leaves Chat, switches away from the bot tab or closes the thread panel that shows it. Hiding or minimising the window alone SHALL NOT pause it.

#### Scenario: One clip at a time
- **WHEN** a clip in the main Chat is playing and the user starts a clip in an open thread panel
- **THEN** the first clip pauses

#### Scenario: Leaving Chat stops sound
- **WHEN** a clip is playing and the user switches the bot tab from Chat to another view
- **THEN** the clip pauses

### Requirement: Audio player is keyboard operable
The play/pause button, seek bar and download button SHALL be reachable with Tab and operable with the keyboard, and their accessible names SHALL include the attachment's name. The seek bar SHALL expose the elapsed time as its value text.

#### Scenario: Keyboard playback
- **WHEN** the user tabs to a loaded clip's play button and presses Space, then tabs to its seek bar and presses the right arrow key
- **THEN** the clip plays and its position moves forward
- **AND** the controls are announced as `Play song.wav` or `Pause song.wav`, `Seek song.wav` and `Download song.wav`

### Requirement: Audio attachments load on demand
An audio player SHALL load its attachment's bytes through the authorized attachment operation only when it nears the viewport. A paused player far from the viewport SHALL release its loaded bytes and load them again when it returns. A load that finishes after the player is gone SHALL be discarded. If the audio cannot be loaded or decoded, the message SHALL show its file chip without a broken player.

#### Scenario: Audio outside the viewport
- **WHEN** Chat history contains an audio attachment far above the visible messages
- **THEN** its bytes are not requested until it nears the viewport

#### Scenario: Audio scrolled far away
- **WHEN** a paused clip that has loaded is scrolled far from the viewport
- **THEN** its loaded bytes are released, and it loads again when scrolled back

#### Scenario: Late load discarded
- **WHEN** a player is removed while its bytes are still loading
- **THEN** the request is aborted and no `blob:` URL is left behind

#### Scenario: Audio cannot be decoded
- **WHEN** an attachment typed `audio/mpeg` fails to decode
- **THEN** the message shows a file chip that downloads it, and the chat stays usable

### Requirement: Audio is not model input
Audio attachments SHALL reach an execution only as files and SHALL NOT be sent to the model as image or audio input.

#### Scenario: Audio is not model input
- **WHEN** a user sends a bot an MP3 named `song.mp3`
- **THEN** the execution receives it as a container file with the `.mp3` extension, the briefing lists its type `audio/mpeg`, and the agent receives no image or audio input for it

#### Scenario: Misnamed audio is delivered by its offered extension
- **WHEN** a user sends MP3 bytes named `song.dat`
- **THEN** the execution's container file uses the `.dat` extension and the briefing lists the type `audio/mpeg`
