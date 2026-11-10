## ADDED Requirements

### Requirement: Unread bot posts are counted on the Home control

The Home control on the project bar SHALL show the window's unread bot post count: the sum of the post counts of the bot notifications the window's server has published to it, over the bots that window knows. It SHALL show no count when that sum is zero. The count SHALL update live, SHALL read `99+` above 99, and SHALL be part of the control's accessible name, stated exactly. The compact chrome row's Home control SHALL NOT show this count.

#### Scenario: Seen from a project

- **WHEN** a project is the selected view and the server has published a notification for the bot Bird with three posts
- **THEN** the Home control shows 3 without the user opening Home, and its accessible name says three unread messages

#### Scenario: Summed over bots

- **WHEN** published notifications hold three posts for Bird and one for Owl
- **THEN** the Home control shows 4

#### Scenario: More than 99

- **WHEN** published notifications hold 120 posts in total
- **THEN** the Home control shows `99+` and its accessible name says 120 unread messages

#### Scenario: Not yet published

- **WHEN** a bot posts and the notification settle period has not yet passed
- **THEN** the Home control does not count the post

#### Scenario: Nothing unread

- **WHEN** the server has published no bot notification
- **THEN** the Home control shows no count and its accessible name is Home

### Requirement: Unread bot posts are counted in the Home sidebar

The Bots item in the Home sidebar SHALL show the same count as the Home control, whether or not its tab is open. Each row in the Home sidebar for a bot on the window's server SHALL show that bot's published post count, and no count when it has none. A row for a bot on another attached server SHALL show no count. The counts SHALL update live, SHALL read `99+` above 99 on a bot's row, and SHALL be part of the item's or row's accessible name.

#### Scenario: Per bot

- **WHEN** published notifications hold three posts for Bird and one for Owl, and the Bots tab is closed
- **THEN** the Bots item shows 4, Bird's row shows 3, and Owl's row shows 1, and Bird's row's accessible name says three unread messages

#### Scenario: A bot on another attached server

- **WHEN** another attached server has a bot with the same id as Bird, and the window's server has published three posts for Bird
- **THEN** the window's Bird row shows 3 and the other server's row shows no count

#### Scenario: A bot the window does not know

- **WHEN** the server publishes a notification for a bot missing from the window's bot list
- **THEN** no row shows its count, and neither the Bots item nor the Home control counts it

### Requirement: Unread bot counts clear on acknowledgement

The Home control, the Bots item, and a bot's sidebar row SHALL stop counting a bot's posts once the server withdraws that bot's notification: when any client shows the bot's Chat, when the user sends the bot a message, or when its notification is dismissed. Clearing one bot SHALL leave every other bot's count in place. The device-local unread divider in a bot's Chat is separate and is not cleared by these counts.

#### Scenario: Opening Chat

- **WHEN** Bird and Owl have unread posts and the user opens Bird's Chat
- **THEN** Bird's row shows no count, and the Bots item and the Home control show only Owl's posts

#### Scenario: Sending a message

- **WHEN** the user sends Bird a message
- **THEN** Bird's row, the Bots item, and the Home control no longer count Bird's posts

#### Scenario: Dismissing the notification

- **WHEN** the user dismisses Bird's row in the Notifications list
- **THEN** Bird's row, the Bots item, and the Home control no longer count Bird's posts, and Bird's Chat still shows its unread divider when opened

#### Scenario: Read on another client

- **WHEN** another client shows Bird's Chat
- **THEN** this window's Bird row, Bots item, and Home control no longer count Bird's posts
