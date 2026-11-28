## ADDED Requirements

### Requirement: Opening a thread leaves the reply composer unfocused

Opening a thread, whether from the Reply in thread action, the message menu or a reply bar, and including switching from one open thread to another, SHALL NOT focus any text field, so a touch device does not raise its on-screen keyboard. Focus SHALL move to the thread panel itself, from which Tab reaches its controls and, with no menu or dialog open, Escape closes the panel. The reply composer SHALL take focus when the user taps, clicks or tabs to it, or uses an action that puts text into it, such as Quote.

#### Scenario: Open a thread from the reply bar on a phone
- **WHEN** a user on a touch device taps a root's reply bar
- **THEN** the thread panel has focus, no text field does, and the on-screen keyboard stays down

#### Scenario: Open a thread from the message menu by keyboard
- **WHEN** a keyboard user chooses Reply in thread from a message's menu
- **THEN** the thread panel has focus rather than the message or the composer
- **AND** pressing Escape closes the panel and focuses the root message

#### Scenario: Reach the composer with Tab
- **WHEN** a thread has just opened and the user presses Tab repeatedly
- **THEN** focus moves through the panel's controls and reaches the reply composer

#### Scenario: Escape with a menu open
- **WHEN** a message menu is open in the thread panel and the user presses Escape
- **THEN** the menu closes and the panel stays open
- **AND** pressing Escape again closes the panel

#### Scenario: Switch threads
- **WHEN** thread M's panel is open and the user opens thread N
- **THEN** N's panel has focus and its composer does not

#### Scenario: Choose to reply
- **WHEN** a thread is open and the user taps its reply composer
- **THEN** the composer takes focus

## MODIFIED Requirements

### Requirement: Reply in thread

Each top-level message in Chat SHALL offer **Reply in thread**, both as an action shown on the message while the pointer is over it or focus is within it, and as an item of its message menu after Quote. A reply SHALL NOT offer Reply in thread. A root with replies SHALL show a reply bar beneath it naming who has replied, the reply count and when the latest reply was posted; activating the reply bar SHALL open that thread. The reply bar SHALL be marked new when the thread's latest bot reply was posted after this device's read position for that bot. Thread replies SHALL NOT appear in the main stream, and the unread divider SHALL count top-level messages only.

#### Scenario: Start a thread from the hover action
- **WHEN** the user points at a bot message and activates Reply in thread
- **THEN** the thread panel opens for that message
- **AND** its composer does not have focus

#### Scenario: Reply bar
- **WHEN** a root has three replies, the latest from the bot five minutes ago
- **THEN** the reply bar under it shows the bot's avatar, "3 replies" and the latest reply's time

#### Scenario: New replies while away
- **WHEN** the bot replies in thread M while the user is on another screen, and the user then opens Chat
- **THEN** M's reply bar is marked new and the main stream gains no message for the reply

#### Scenario: Only the user replied since
- **WHEN** thread M's only bot reply is older than this device's read position and the user has replied since
- **THEN** M's reply bar is not marked new
