## MODIFIED Requirements

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

## ADDED Requirements

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
