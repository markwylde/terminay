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

## MODIFIED Requirements

### Requirement: Thread panel

Opening a thread SHALL show a thread panel beside the main stream, or over it where the chat is too narrow for both, with the root message, a divider giving the reply count, the replies oldest first with paginated older replies, and a composer. The panel composer SHALL behave as the main composer does: attachments by button, drop and paste with the same limits, Enter to send, failure kept with draft and files, and retries reusing the same idempotency key. A message sent from it SHALL be a reply in that thread. Each thread SHALL keep its own draft text while the bot tab stays open. Pending files and an unsent attempt SHALL belong to the thread they were added in: switching to another thread or closing the panel SHALL discard that thread's pending files, never carry them into another thread. A send already under way SHALL complete into the thread it was started in. New, edited and deleted replies and changes to the root SHALL appear in the panel live, without discarding older replies already loaded or moving the reading position. Replies SHALL offer Quote, Edit message and Delete message from their message menu, and Quote SHALL append to the panel's draft. Deleting a root whose thread has replies SHALL be labelled as deleting its replies too. The panel SHALL close with its close button or Escape, and SHALL close when its root is deleted or the chat is cleared. Opening a different thread SHALL replace the panel's contents.

#### Scenario: Reply from the panel
- **WHEN** the thread panel for M is open and the user types "Ship it" and presses Enter
- **THEN** a reply with `threadId` M appears in the panel, the main stream is unchanged except for M's reply bar showing one more reply, and a fresh execution starts

#### Scenario: Bot reply arrives live
- **WHEN** the panel for M is open and the bot posts a reply in M
- **THEN** the reply appears at the end of the panel without reloading

#### Scenario: Reply deleted elsewhere
- **WHEN** the panel for M shows older replies loaded by scrolling up and a reply is deleted on another device
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
