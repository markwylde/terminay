## MODIFIED Requirements

### Requirement: Header Notifications control

The header SHALL present exactly one Notifications control: an icon button named **Notifications** that is always visible, whether or not anything is listed. The control SHALL carry a single red count badge whose number is the count of notifications across every attached connection: terminals that need attention, terminals with finished unviewed activity, and bots with unacknowledged posts, one per bot. Working terminals SHALL NOT contribute to the number. The badge SHALL be hidden when the number is zero. The badge SHALL be a circle of one fixed size regardless of the number it displays, with the number centred, the font size stepping down as the digit count grows, and counts above 99 displayed as `99+`. The control's accessible name SHALL state the number of notifications.

#### Scenario: Notifications of both kinds

- **WHEN** one terminal needs attention and two terminals have finished unviewed activity
- **THEN** the header shows one Notifications icon with a single red badge reading `3`

#### Scenario: Working terminals are not counted

- **WHEN** four terminals are working and nothing needs attention or has finished unviewed
- **THEN** the Notifications icon is visible with no badge

#### Scenario: Nothing at all

- **WHEN** no terminal is working, needs attention, or has finished unviewed activity
- **THEN** the Notifications icon is still visible with no badge, and it can be opened

#### Scenario: Counting across attached servers

- **WHEN** one attached server has two finished unviewed terminals and another has one terminal needing attention
- **THEN** the badge reads `3`

#### Scenario: Count capped at 99+

- **WHEN** more than 99 terminals have finished unviewed activity
- **THEN** the badge reads `99+` and its width still equals its height

#### Scenario: A bot counts once

- **WHEN** one terminal has finished unviewed activity and the bot Bird has three unacknowledged posts
- **THEN** the badge reads `2`

### Requirement: Notifications list

Opening the Notifications control SHALL show the list of notifications, attention before finished, newest first within each. Each row SHALL be keyed by its server and its owner: the project and terminal for a terminal notification, or the bot for a bot notification. A terminal row SHALL read as a notification: its status dot, a headline saying what happened in that terminal (an agent finishing, waiting, or blocked; a command finishing; a terminal needing attention), the terminal's title and its project, and how long ago it happened when that time is known. Bot rows SHALL be listed in the attention group. Working terminals SHALL NOT appear in the list. When there are no notifications the list SHALL show an empty state reading that there are no notifications. Activating a terminal row SHALL select that terminal on its own server, as selecting its tab does, and close the list. Activating a bot row SHALL behave as the bot-row requirement states. The **Show indicator for active tabs** and **Show indicator for finished tabs** settings SHALL govern terminal rows only.

#### Scenario: Order and contents

- **WHEN** one terminal needs attention, one has finished unviewed, and one is working
- **THEN** the list shows the attention row, then the finished row, and no row for the working terminal

#### Scenario: A row says what happened

- **WHEN** an agent in the terminal titled `Terminal 1` of the project `Project 2` finished 23 seconds ago and stays unacknowledged
- **THEN** its row reads `Agent finished`, names `Terminal 1` and `Project 2`, and says `23 seconds ago`

#### Scenario: Newest first

- **WHEN** two terminals have finished unviewed activity at different times
- **THEN** the more recent one is listed above the older one

#### Scenario: Only working terminals

- **WHEN** two terminals are working and there are no notifications
- **THEN** the list shows only the empty state

#### Scenario: Activating a notification

- **WHEN** a user activates a finished row for a terminal in a background project on another attached server
- **THEN** that project is activated, that terminal is selected on its own server, the list closes, and the notification clears as it would on clicking that terminal's tab

#### Scenario: Rows from two attached servers

- **WHEN** two attached servers each hold a terminal needing attention
- **THEN** the list shows both rows, each naming its own server and project

#### Scenario: Bot row among terminal rows

- **WHEN** one terminal has finished unviewed activity and Bird has an unacknowledged post
- **THEN** Bird's row is listed in the attention group, above the finished terminal row

#### Scenario: Indicator settings off

- **WHEN** **Show indicator for finished tabs** is off and Bird posts
- **THEN** Bird's row is still listed and counted

### Requirement: Dismissing notifications

Each notification row SHALL carry a dismiss control, and the list SHALL carry a **Clear all** control whenever at least one notification is listed. Dismissing a terminal notification SHALL acknowledge that terminal on its own server exactly as selecting its tab does, without selecting the terminal or activating its project, so that its terminal tab dot, its project dot, and the header number clear together on every attached client. Dismissing a bot notification SHALL acknowledge that bot's posts on its own server without opening its tab, so that the notification clears on every attached client. **Clear all** SHALL do the same for every listed notification on every attached connection. **Clear all** SHALL NOT affect working terminals, whose tab and project dots remain. The list SHALL stay open after a dismissal.

#### Scenario: Dismissing one notification

- **WHEN** a user dismisses a finished notification for a terminal in a background project
- **THEN** the row leaves the list, the header number drops by one, that terminal's tab dot clears, the active project and selected terminal are unchanged, and the list stays open

#### Scenario: Dismissing the last notification of a project

- **WHEN** a user dismisses the only notification in a project that has no working terminal
- **THEN** that project's tab dot hides

#### Scenario: Clear all

- **WHEN** three notifications are listed across two attached servers and one terminal is working, and the user presses **Clear all**
- **THEN** all three notifications are acknowledged on their own servers, the header badge hides, the empty state shows, and the working terminal's tab still shows its working dot

#### Scenario: Dismissal reaches other clients

- **WHEN** two clients are attached to the same server and one dismisses a notification
- **THEN** the notification clears on the other client as well

#### Scenario: Clear all with nothing to clear

- **WHEN** there are no notifications
- **THEN** no **Clear all** control is shown

#### Scenario: Dismissing a bot row

- **WHEN** a user dismisses Bird's row
- **THEN** the row leaves the list, the badge drops by one, no tab opens or changes, and the list stays open

#### Scenario: Clear all with bot rows on two servers

- **WHEN** the list holds Bird's row from one attached server, Pixel's row from another, and one terminal row, and the user presses **Clear all**
- **THEN** each bot's posts are acknowledged on its own server, the terminal is acknowledged, the badge hides, and the empty state shows

## ADDED Requirements

### Requirement: Bot notification rows

A bot row SHALL show the bot's avatar and colour, the headline `New message` or `<n> new messages`, the bot's name, the excerpt of its latest post, and how long ago that post was made. The row SHALL be resolved on the server that published it, so bots with the same id on two servers are two rows. Activating a bot row SHALL open that bot's tab on its own server in Chat, or bring that tab to the front in Chat, and close the list.

#### Scenario: A bot row reads as a message

- **WHEN** Bird's notification covers two posts, the latest `Build is green`, posted 10 seconds ago
- **THEN** its row shows Bird's avatar, `2 new messages`, `Bird`, `Build is green`, and `10 seconds ago`

#### Scenario: Opening a bot from the list

- **WHEN** a user activates Bird's row while another Home tab is in front
- **THEN** Bird's tab opens in Chat in front, the list closes, and Bird's notification is removed on every client

#### Scenario: Same bot id on two servers

- **WHEN** two attached servers each have a bot with the same id and each has posted
- **THEN** the list shows two rows, and activating or dismissing one acts only on the server that published it
