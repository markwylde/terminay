## ADDED Requirements

### Requirement: Inline transcript images are bounded by their transcript
An image shown inline in a bot transcript SHALL be no taller than 40% of the visible content height of the transcript area that contains it, excluding that area's padding, and no wider than that area's content width. It SHALL keep its aspect ratio, never stretched or cropped, and an image within both bounds SHALL show at its natural size. The bound SHALL follow the transcript area whenever its size changes.

#### Scenario: Bot posts a large image
- **WHEN** a bot message carries an image whose natural height is greater than the Chat transcript's visible height
- **THEN** the image is shown no taller than 40% of that visible height, with its natural aspect ratio

#### Scenario: Tall image
- **WHEN** a message carries an image that is much taller than it is wide
- **THEN** the image is shown no taller than 40% of the transcript's visible height, its width reduced in proportion, and it is not cropped

#### Scenario: Wide image
- **WHEN** a message carries an image that is wider than the transcript's content width
- **THEN** the image is shown no wider than the content width, its height reduced in proportion, and no taller than 40% of the transcript's visible height

#### Scenario: Small image
- **WHEN** a message carries an image smaller than both bounds
- **THEN** the image is shown at its natural size

#### Scenario: Window is resized
- **WHEN** the window is made shorter or taller while an image is shown in Chat
- **THEN** the image's displayed height stays within 40% of the transcript's new visible height, with its natural aspect ratio

#### Scenario: Transcript shrinks inside a fixed window
- **WHEN** the composer grows with a multi-line draft, making the Chat transcript shorter while the window size is unchanged
- **THEN** the image's displayed height stays within 40% of the transcript's new visible height

### Requirement: Every inline transcript image shares the bound
The inline image bound SHALL apply to image attachments on user and bot messages, to each image of a message with several images, and to Markdown image previews, in Chat and in a thread panel.

#### Scenario: Several images in one message
- **WHEN** a user message carries more than one image
- **THEN** each image is shown no taller than 40% of the transcript's visible height

#### Scenario: Bot posts an image attachment
- **WHEN** a bot message carries an image attachment
- **THEN** the image is shown no taller than 40% of the transcript's visible height

#### Scenario: Thread panel
- **WHEN** an image is shown in a thread panel
- **THEN** it is no taller than 40% of that panel's visible transcript height
