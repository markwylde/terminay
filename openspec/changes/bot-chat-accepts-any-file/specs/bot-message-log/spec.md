## RENAMED Requirements

- FROM: `### Requirement: Message images reach the execution`
- TO: `### Requirement: Message attachments reach the execution`

## MODIFIED Requirements

### Requirement: Durable messages and attachments
Messages SHALL have stable IDs, monotonic order, author provenance, timestamps and revisions. Edit/delete/clear SHALL act on communication records, never rewrite diagnostic transcripts or replay prior actions. Running executions SHALL observe these changes through events. Raster attachments posted by a bot SHALL be captured into bounded server-owned storage and remain readable after execution completion or container replacement. Tool results SHALL return attachment metadata rather than image bytes.

User messages SHALL be able to carry attachments of any file type that an authorized client uploads before posting.

**Upload.**

Each upload carries one file and returns an opaque upload token bound to that bot, the file and the name offered for it. The server SHALL determine the type from the file content alone: PNG, JPEG, GIF and WebP content is an image of that type, and any other content is stored as `application/octet-stream`, whatever type or name the client offers. It SHALL refuse an empty upload, an image larger than 2 MiB, any other file larger than 5 MiB, and any upload that would push the bot's attachment storage, staged uploads included, past its bound. Offered names SHALL be treated as display text, never as paths.

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

The composer SHALL offer an attach button that opens a picker for files of any type. Files dropped onto the composer, and files pasted into it, SHALL be added the same way. The composer SHALL classify each file by its content, never by its claimed type or name. Each pending file SHALL show before sending with a remove control: PNG, JPEG, GIF or WebP content as a thumbnail, and any other file as a chip with a file icon, its name and its size. Send SHALL be enabled when the draft has text or at least one pending file. The composer SHALL refuse a fifth file, an image over 2 MiB or any other file over 5 MiB with an inline message, and leave the other pending files unchanged. Pending files SHALL be cleared once the message is posted and kept if posting fails. When the outcome of a send is unknown, a retry SHALL reuse the same idempotency key and any tokens already obtained, so the message is not duplicated. User messages SHALL show their image attachments inline, the same way bot posts do, and every other attachment as a file chip with its name and size. Activating a file chip SHALL save the attachment's bytes through the host's save flow; a non-image attachment SHALL never be rendered or opened in the workspace.

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
- **THEN** the execution fails with the copy error as its reason, does not start the agent, and the execution's attachment directory is removed

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
