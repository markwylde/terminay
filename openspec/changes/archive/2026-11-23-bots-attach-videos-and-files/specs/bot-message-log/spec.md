## ADDED Requirements

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

## MODIFIED Requirements

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
