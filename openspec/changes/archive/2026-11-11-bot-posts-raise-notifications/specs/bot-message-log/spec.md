## ADDED Requirements

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

A bot notification SHALL carry the bot's identity, the number of its unacknowledged posts, a plain-text excerpt of the latest of them of at most 280 characters, and the time that post was made. A post with attachments and no text SHALL have an excerpt saying the bot sent an image. Editing an unacknowledged post SHALL update the notification to reflect the latest remaining one.

#### Scenario: Content of one post

- **WHEN** Bird posts `Build is green`
- **THEN** its notification has an unread count of 1, the excerpt `Build is green`, and the post's time

#### Scenario: An image without text

- **WHEN** Bird posts a screenshot with no text
- **THEN** its notification's excerpt says that Bird sent an image

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
