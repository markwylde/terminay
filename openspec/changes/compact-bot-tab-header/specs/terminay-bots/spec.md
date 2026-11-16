## MODIFIED Requirements

### Requirement: Bot tabs

A bot tab SHALL be a Home tab that belongs to the Bots section. Its title SHALL be the bot's name, shown with its avatar. It SHALL offer two modes:

- **Chat**: the bot's conversation, with a context rail. The rail shows a live view-only thumbnail of the bot's desktop, the bot's recent sessions, its upcoming trigger firings, and shortcuts to Files, Shell, and Desktop.
- **Configure**: the tabs Profile, Environment, Memories, Triggers, and Sessions.

The context rail SHALL be shown only in Chat mode. A bot tab SHALL keep its mode, its chosen configure tab, unsent text, and scroll position, as Home tabs keep their state. Renaming a bot SHALL retitle its tab. Deleting a bot SHALL close its tab on every device.

A bot tab's header SHALL show the bot's avatar with its activity dot and the bot's name on one line, truncated with an ellipsis when it does not fit and never drawn over another control. When the tab is wider than 600px the header SHALL also show the agent, model, and container line, the status chip, the Enable bot or Disable bot control when the server supports it, and the Chat/Configure switch. When the tab is 600px wide or narrower the header SHALL instead show a single settings control after the name, SHALL NOT draw the agent line, and SHALL draw the status chip only while the bot is disabled; the status SHALL remain available to assistive technology at every width. The settings control SHALL open a menu offering Chat and Configure, with the current mode marked visually and to assistive technology, and Enable bot or Disable bot only when the server supports it. The menu SHALL be operable from the keyboard, SHALL close when an item is chosen, on Escape, or on a press outside it, and SHALL return focus to the settings control when an item is chosen or Escape is pressed.

#### Scenario: Switching modes

- **WHEN** a user switches a bot tab from Chat to Configure
- **THEN** the configure tabs are shown with Profile in front, and the context rail is hidden

#### Scenario: Unsent message kept

- **WHEN** a user types a message into a bot's chat without sending it, opens another Home tab, and returns
- **THEN** the message is still in the composer as typed

#### Scenario: Bot deleted elsewhere

- **WHEN** a bot is deleted from another device while its tab is open
- **THEN** the tab closes and the device shows that the bot was deleted

#### Scenario: Narrow bot tab header

- **WHEN** a bot tab is 600px wide or narrower
- **THEN** its header shows the avatar, the bot's name, and a settings control, with no agent line, Disable bot button, or Chat/Configure switch, and no visible status chip unless the bot is disabled

#### Scenario: Settings menu on a narrow bot tab

- **WHEN** a user on a narrow bot tab opens the settings control on a server that supports bot availability
- **THEN** the menu offers Chat, marked as current, Configure, and Disable bot

#### Scenario: Choosing a mode from the settings menu

- **WHEN** a user on a narrow bot tab chooses Configure from the settings menu
- **THEN** the tab switches to Configure and the menu closes

#### Scenario: Server without bot availability

- **WHEN** a user opens the settings menu on a narrow bot tab whose server does not support bot availability
- **THEN** the menu offers only Chat and Configure

#### Scenario: Disabled bot on a narrow tab

- **WHEN** a user disables a bot from the settings menu on a narrow bot tab
- **THEN** the header shows a Disabled status chip and the menu offers Enable bot

#### Scenario: Long bot name

- **WHEN** a bot's name is longer than its header has room for
- **THEN** the name ends in an ellipsis and does not overlap any other header control
