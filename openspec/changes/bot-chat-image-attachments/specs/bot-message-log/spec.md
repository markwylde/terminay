## MODIFIED Requirements

### Requirement: Durable messages and attachments
Messages SHALL have stable IDs, monotonic order, author provenance, timestamps and revisions. Edit/delete/clear SHALL act on communication records, never rewrite diagnostic transcripts or replay prior actions. Running executions SHALL observe these changes through events. Posted raster attachments SHALL be captured into bounded server-owned storage and remain readable after execution completion or container replacement. Tool results SHALL return attachment metadata rather than image bytes.

User messages SHALL be able to carry raster attachments that an authorized client uploads before posting.

**Upload.**

Each upload carries one image and returns an opaque upload token bound to that bot, the image and the name offered for it. The server SHALL determine the type from the image content and accept only PNG, JPEG, GIF and WebP. It SHALL refuse an image larger than 2 MiB, and any upload that would push the bot's attachment storage, staged images included, past its bound. Offered names SHALL be treated as display text, never as paths.

**Post.**

A post SHALL reference at most four distinct upload tokens. Its text MAY be empty when it references at least one token. The post SHALL be checked in this order:

1. The idempotency key is checked first. Repeating an earlier post with the same key and content returns that post's message, even if its tokens have since been consumed.
2. The tokens are checked. A token that is unknown, expired, consumed, bound to another bot or repeated in the same post SHALL cause the whole post to be refused, with no message created.
3. The message is persisted, and only then are its tokens consumed. A failed persist SHALL leave the tokens usable.

**Staging and expiry.**

A staged image SHALL NOT be pruned while its token is valid. Tokens SHALL expire after a bounded staging period. Expired staged images SHALL be discarded when the bot's attachments are next uploaded, posted, pruned or loaded. Clearing the chat or deleting the bot SHALL discard all of its staged images.

#### Scenario: Screenshot survives recreation
- **WHEN** a posted screenshot's original container file disappears
- **THEN** its durable message attachment remains available to authorized clients

#### Scenario: User posts an image
- **WHEN** an authorized client uploads a PNG and posts a message referencing it
- **THEN** the user message records the attachment with its name, type and size
- **AND** the image is readable through the attachment operation after the bot's container is replaced

#### Scenario: Unsupported or oversized upload
- **WHEN** a client uploads a file whose content is not PNG, JPEG, GIF or WebP, or an image over 2 MiB
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
- **WHEN** an image is staged and its token expires without being posted
- **THEN** the image is discarded at the bot's next attachment upload, post, prune or load, and no longer counts toward storage

#### Scenario: Clear discards staging
- **WHEN** the chat is cleared while images are staged
- **THEN** those staged images are discarded and their tokens are refused

### Requirement: Communication UI
Chat SHALL show the bot's shared message log with paginated history, explicit pending/failure states, message controls and inline durable attachments. Session selection SHALL open execution details without changing chat history. Raw thoughts, tools and provider output SHALL remain in execution details. New chat and conversation continuation SHALL not define ordinary messaging behavior. Schedules and events SHALL start fresh executions with the same runtime tools and communication log.

The composer SHALL offer an attach button that opens a picker for PNG, JPEG, GIF and WebP images. Image files dropped onto the composer, and images pasted into it, SHALL be added the same way. Each pending image SHALL show as a thumbnail with a remove control before sending. Send SHALL be enabled when the draft has text or at least one pending image. The composer SHALL refuse a fifth image, a non-image file or an image over 2 MiB with an inline message, and leave the other pending images unchanged. Pending images SHALL be cleared once the message is posted and kept if posting fails. When the outcome of a send is unknown, a retry SHALL reuse the same idempotency key and any tokens already obtained, so the message is not duplicated. User messages SHALL show their attachments inline, the same way bot posts do.

#### Scenario: Read execution details
- **WHEN** a user selects a recent execution
- **THEN** its diagnostics open separately and the shared chat log remains intact

#### Scenario: Enter Chat with delayed images
- **WHEN** Chat becomes visible and message images load after the initial history render
- **THEN** the message viewport starts at the bottom and stays there as the content grows, without scroll animation
- **AND** manually scrolling up suspends automatic following until the user returns to the bottom or re-enters Chat
- **AND** browser layout/anchoring scroll events do not count as manual history scrolling
- **AND** the existing Sessions labels are retained

#### Scenario: Attach with the button
- **WHEN** the user clicks the attach button and chooses an image
- **THEN** a thumbnail of the image appears in the composer with a remove control

#### Scenario: Drop and paste
- **WHEN** the user drops an image file onto the composer or pastes an image from the clipboard
- **THEN** the image is added to the pending thumbnails
- **AND** pasting plain text still inserts the text into the draft

#### Scenario: Remove before sending
- **WHEN** the user removes a pending thumbnail
- **THEN** that image is not sent with the message

#### Scenario: Send image only
- **WHEN** the draft is empty and one image is pending and the user presses Enter
- **THEN** a user message with that image and no text appears in the chat log
- **AND** the composer clears its pending images

#### Scenario: Too many or invalid files
- **WHEN** four images are pending and the user adds another, or adds a non-image file or an image over 2 MiB
- **THEN** the composer shows an inline message and leaves the pending images unchanged

#### Scenario: Send fails
- **WHEN** an upload or the post is refused
- **THEN** the composer shows the error and keeps the draft text and pending images

## ADDED Requirements

### Requirement: Message images reach the execution
An execution started by a user message with attachments SHALL receive those images as model input in the agent's native image form, not only as text references.

The attachment list SHALL be snapshotted when the execution is dispatched. If any snapshotted image can no longer be read when the execution starts, the execution SHALL fail with an explicit reason. It SHALL NOT start without the image, and the posted message SHALL remain.

Before the agent starts, the server SHALL write each image into the owning bot container. The file name is chosen by the server from the image's position and type and never uses the offered name. Writes SHALL refuse symlinks and leave no partial file. The execution briefing SHALL list each image's name, type and container path. The execution's copies SHALL be removed when it ends; the durable attachment remains the record.

Images SHALL be delivered only to the execution triggered by that message. Briefings for other executions SHALL keep attachment metadata only.

#### Scenario: Claude Code bot sees a pasted screenshot
- **WHEN** the user sends a screenshot to a Claude Code bot
- **THEN** the triggered execution's first user turn contains the image as an image content block
- **AND** the briefing names the image and its container path

#### Scenario: Codex bot sees an attached image
- **WHEN** the user sends an image to a Codex bot
- **THEN** the image is written into the bot container and passed to Codex as an image input for the initial prompt

#### Scenario: Image deleted before start
- **WHEN** a queued image message's attachment is removed by clearing the chat before its execution starts
- **THEN** the execution does not run without the image and reports why

#### Scenario: Copies are removed
- **WHEN** an execution that received images completes, fails or is stopped
- **THEN** its container copies are removed and the message's durable attachments remain readable

#### Scenario: Later execution
- **WHEN** a schedule starts an execution after an image message was posted
- **THEN** its briefing shows the message's attachment count and metadata, and no image bytes are attached to its prompt
