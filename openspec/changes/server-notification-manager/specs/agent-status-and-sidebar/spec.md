## MODIFIED Requirements

### Requirement: Header Notifications control

The header SHALL present exactly one Notifications control: an icon button named **Notifications** that is always visible, whether or not anything is listed. The control SHALL carry a single red count badge whose number is the count of notifications the server has published, across every attached connection. A notification that is still within its settle period, and a working terminal, SHALL NOT contribute to the number. The badge SHALL be hidden when the number is zero. The badge SHALL be a circle of one fixed size regardless of the number it displays, with the number centred, the font size stepping down as the digit count grows, and counts above 99 displayed as `99+`. The control's accessible name SHALL state the number of notifications.

#### Scenario: Notifications of both kinds

- **WHEN** one terminal needs attention and two terminals have finished unviewed activity, and all three notifications are published
- **THEN** the header shows one Notifications icon with a single red badge reading `3`

#### Scenario: Working terminals are not counted

- **WHEN** four terminals are working and nothing needs attention or has finished unviewed
- **THEN** the Notifications icon is visible with no badge

#### Scenario: Nothing at all

- **WHEN** no terminal is working, needs attention, or has finished unviewed activity
- **THEN** the Notifications icon is still visible with no badge, and it can be opened

#### Scenario: Counting across attached servers

- **WHEN** one attached server has two published finished notifications and another has one published attention notification
- **THEN** the badge reads `3`

#### Scenario: Count capped at 99+

- **WHEN** more than 99 notifications are published
- **THEN** the badge reads `99+` and its width still equals its height

#### Scenario: A notification within its settle period

- **WHEN** a terminal finished unviewed two seconds ago
- **THEN** its tab indicator shows finished and the header badge does not yet count it

#### Scenario: A notification an agent sent

- **WHEN** an agent's sent notification is published for a terminal that has no other notification
- **THEN** the header badge counts it as one

### Requirement: Notifications list

Opening the Notifications control SHALL show the list of notifications the server has published, attention before finished, newest first within each, each row keyed by its server and project. A row SHALL read as a notification: its status dot, a headline saying what happened in that terminal (an agent finishing, waiting, or blocked; a command finishing; a terminal needing attention), the terminal's title and its project, and how long ago it happened when that time is known. A row for a notification a process sent SHALL show that notification's title as its headline, or its body where it has no title, followed by its body, and SHALL still name the terminal and project it belongs to; such a row SHALL be ordered with attention rows. Working terminals SHALL NOT appear in the list. When there are no notifications the list SHALL show an empty state reading that there are no notifications. Activating a row SHALL select that terminal on its own server, as selecting its tab does, and close the list. The list's contents SHALL be governed by the **Show indicator for active tabs** and **Show indicator for finished tabs** settings.

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

#### Scenario: A row for a sent notification

- **WHEN** an agent in `Terminal 1` of `Project 2` sent a notification titled `Review ready` with the body `Three files changed`, and it is published
- **THEN** its row reads `Review ready` and `Three files changed`, and names `Terminal 1` and `Project 2`

### Requirement: Dismissing notifications

Each notification row SHALL carry a dismiss control, and the list SHALL carry a **Clear all** control whenever at least one notification is listed. Dismissing a notification that came from terminal activity SHALL acknowledge that terminal on its own server exactly as selecting its tab does, without selecting the terminal or activating its project, so that its terminal tab dot, its project dot, and the header number clear together on every attached client. Dismissing a notification a process sent SHALL remove that notification on its own server for every attached client and SHALL leave that terminal's other notifications in place. **Clear all** SHALL remove every listed notification on every attached connection. **Clear all** SHALL NOT affect working terminals, whose tab and project dots remain. The list SHALL stay open after a dismissal.

#### Scenario: Dismissing one notification

- **WHEN** a user dismisses a finished notification for a terminal in a background project
- **THEN** the row leaves the list, the header number drops by one, that terminal's tab dot clears, the active project and selected terminal are unchanged, and the list stays open

#### Scenario: Dismissing the last notification of a project

- **WHEN** a user dismisses the only notification in a project that has no working terminal
- **THEN** that project's tab dot hides

#### Scenario: Clear all

- **WHEN** three notifications are listed across two attached servers and one terminal is working, and the user presses **Clear all**
- **THEN** all three notifications are removed on their own servers, the header badge hides, the empty state shows, and the working terminal's tab still shows its working dot

#### Scenario: Dismissal reaches other clients

- **WHEN** two clients are attached to the same server and one dismisses a notification
- **THEN** the notification clears on the other client as well

#### Scenario: Clear all with nothing to clear

- **WHEN** there are no notifications
- **THEN** no **Clear all** control is shown

#### Scenario: Dismissing a sent notification

- **WHEN** a terminal has an agent-finished notification and a notification an agent sent, and the user dismisses the sent one
- **THEN** only that row leaves the list and the header number drops by one
