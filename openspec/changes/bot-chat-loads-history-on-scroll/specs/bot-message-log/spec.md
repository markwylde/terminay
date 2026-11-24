## ADDED Requirements

### Requirement: History loads as the reader scrolls up
Chat and the thread panel SHALL load older history as the reader scrolls up, with no control to press. A view SHALL request its next older page while its oldest loaded message is within one viewport height above the visible area, and SHALL check again after each page. It SHALL have at most one older-page request in flight, and SHALL drop a response that arrives after it has reloaded, been cleared, or switched bot or thread.

#### Scenario: Scrolling up loads earlier messages
- **WHEN** a bot's chat holds 60 messages, Chat shows the newest 25, and the reader scrolls up toward the oldest of them
- **THEN** the next 25 messages are requested before the reader reaches the top and appear above the loaded ones
- **AND** no "Load older messages" control is shown

#### Scenario: One request at a time
- **WHEN** an older page is still loading and the reader keeps scrolling at the top of the history
- **THEN** no second request for older messages is made until the first completes

#### Scenario: A tall view fills
- **WHEN** Chat opens in a viewport taller than the newest page of messages and older pages exist
- **THEN** older pages load until the oldest loaded message is more than one viewport height above the visible area, or the oldest message is loaded
- **AND** Chat stays at the bottom, showing the newest message

#### Scenario: Older replies in a thread
- **WHEN** a thread has 40 replies, its panel shows the newest 25, and the reader scrolls up toward the oldest loaded reply
- **THEN** the older replies load between the reply-count divider and the loaded replies
- **AND** no "Load older replies" control is shown

#### Scenario: A stale page is dropped
- **WHEN** an older page is still loading and the chat is cleared, or the view switches to another bot
- **THEN** that page's messages, loading state and any failure never appear in the new view

### Requirement: Older history keeps the reading position
Prepending older messages SHALL keep the message the reader is looking at at the same position on screen. Loading older history SHALL not stop Chat or a thread from following new messages while the reader is at the bottom, and SHALL not scroll a reader who has scrolled up. Loading older history SHALL not acknowledge messages or move this device's read position.

#### Scenario: Reading position is kept
- **WHEN** the reader has scrolled up so message M is at the top of the viewport and an older page is prepended
- **THEN** M stays at the same position on screen

#### Scenario: Older history loads while following
- **WHEN** Chat is at the bottom, following new messages, and an older page is prepended
- **THEN** Chat remains at the bottom, showing the newest message

#### Scenario: New messages while reading older history
- **WHEN** the reader has scrolled up into older history and the bot posts a new message
- **THEN** the reader's position does not move

#### Scenario: Reading position in a thread
- **WHEN** the reader has scrolled up in a thread panel and older replies are prepended
- **THEN** the reply being read stays in place and the panel does not return to the bottom when the next reply arrives

#### Scenario: An older root with a newer reply
- **WHEN** an older page brings in a root whose thread has a reply posted after everything Chat had shown
- **THEN** the thread is still marked as having new replies, and that reply is not acknowledged until the reader opens that thread

### Requirement: Older history shows its loading, failure and start
While an older page loads, a view SHALL show a loading indicator at the top of the loaded history and announce it politely to assistive technology. A failed older-page request SHALL show an inline error with a Retry control in the same place, and SHALL not be retried until the reader chooses Retry. Once Chat has loaded its oldest message, it SHALL show a "Start of conversation" marker above it and request no further older pages. A thread's start is its root, which the panel always shows.

#### Scenario: Loading indicator
- **WHEN** an older page is loading
- **THEN** a loading indicator is shown at the top of the history and announced as a polite status

#### Scenario: Start of conversation
- **WHEN** the reader scrolls up until the oldest message is loaded
- **THEN** a "Start of conversation" marker is shown above the oldest message and no further older pages are requested

#### Scenario: A failed page waits for Retry
- **WHEN** a request for older messages fails
- **THEN** an inline error with Retry is shown at the top of the history and no further request is made by itself
- **AND** choosing Retry requests the same page again
