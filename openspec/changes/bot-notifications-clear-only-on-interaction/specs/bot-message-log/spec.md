## MODIFIED Requirements

### Requirement: Bot notification settle

A bot notification SHALL be published only after the settle period that applies to every notification, counted from the first unacknowledged post. One acknowledged while pending SHALL NEVER be shown to anyone. A post that updates a published notification SHALL NOT withdraw it or restart the settle period.

#### Scenario: Viewed within the settle period

- **WHEN** Bird posts while a user is viewing Bird's Chat, and the user clicks into the Chat before the settle period ends
- **THEN** the post is acknowledged and no client is ever shown a notification for it

#### Scenario: Update while published

- **WHEN** Bird's notification is published and Bird posts again
- **THEN** the published notification changes in place to a count of 2 and never disappears

### Requirement: What acknowledges bot posts

Only something the user does SHALL acknowledge a bot's posts, through the latest sequence the client observed. Each of the following SHALL acknowledge:

- bringing the bot's tab forward in Chat: clicking the tab, the bot's sidebar row, a Home widget item for the bot, or the bot's notification row;
- switching the bot's tab to Chat;
- a pointer press or a key press inside the bot's tab while it shows Chat, including typing in its composer;
- a user posting to that bot;
- dismissing the bot's notification, or **Clear all**.

Being on screen SHALL NOT acknowledge. A Chat that is visible because the window returned to the front, because Home was brought in front of a project, or because the tab was restored SHALL NOT acknowledge. A bot post arriving while its Chat is visible SHALL NOT be acknowledged until the user next does one of the above. Scrolling and pointer movement SHALL NOT acknowledge. An action taken while the tab shows Configure, other than switching to Chat, SHALL NOT acknowledge. An action that brings the tab forward before its messages have loaded SHALL acknowledge once they load.

#### Scenario: Viewing on another device

- **WHEN** Bird's notification is published and a user opens Bird's Chat from its sidebar row on a phone
- **THEN** the notification is removed on the phone and on the desktop

#### Scenario: Post while Chat is visible

- **WHEN** a user is viewing Bird's Chat and Bird posts, and the user does nothing
- **THEN** Bird's notification is published after the settle period

#### Scenario: Acting on a visible Chat

- **WHEN** Bird's notification is published while its Chat is visible, and the user clicks into the Chat or types in its composer
- **THEN** the notification is removed

#### Scenario: Returning to the window

- **WHEN** Bird posts while Bird's Chat is in front in a window the user has left for another application, and the user returns to that window
- **THEN** Bird's notification remains until the user acts in Bird's tab

#### Scenario: Hidden window

- **WHEN** Bird's tab is in Chat in a window that is hidden, and Bird posts
- **THEN** the post is not acknowledged and Bird's notification is published

#### Scenario: Configure

- **WHEN** Bird's tab shows Configure and the user clicks among its triggers while Bird holds a notification
- **THEN** the notification remains

#### Scenario: Dismissal races a post

- **WHEN** a user dismisses Bird's notification covering sequence 7 while Bird posts at sequence 8
- **THEN** sequence 8 remains unacknowledged and Bird holds a notification for it
