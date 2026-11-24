## MODIFIED Requirements

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
