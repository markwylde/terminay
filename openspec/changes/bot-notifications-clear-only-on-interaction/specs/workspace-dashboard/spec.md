## MODIFIED Requirements

### Requirement: Unread bot counts clear on acknowledgement

The Home control, the Bots item, and a bot's sidebar row SHALL stop counting a bot's posts once the server withdraws that bot's notification: when the user on any client acts on the bot's Chat as the bot message log defines, when the user sends the bot a message, or when its notification is dismissed. A bot's Chat being on screen SHALL NOT by itself clear its count. Clearing one bot SHALL leave every other bot's count in place. The device-local unread divider in a bot's Chat is separate and is not cleared by these counts.

#### Scenario: Opening Chat

- **WHEN** Bird and Owl have unread posts and the user opens Bird's Chat from its sidebar row
- **THEN** Bird's row shows no count, and the Bots item and the Home control show only Owl's posts

#### Scenario: Chat already on screen

- **WHEN** Bird's Chat is in front and Bird posts while the user does nothing
- **THEN** Bird's row, the Bots item, and the Home control count Bird's post after the settle period

#### Scenario: Sending a message

- **WHEN** the user sends Bird a message
- **THEN** Bird's row, the Bots item, and the Home control no longer count Bird's posts

#### Scenario: Dismissing the notification

- **WHEN** the user dismisses Bird's row in the Notifications list
- **THEN** Bird's row, the Bots item, and the Home control no longer count Bird's posts, and Bird's Chat still shows its unread divider when opened

#### Scenario: Read on another client

- **WHEN** the user opens Bird's Chat from its sidebar row on another client
- **THEN** this window's Bird row, Bots item, and Home control no longer count Bird's posts
