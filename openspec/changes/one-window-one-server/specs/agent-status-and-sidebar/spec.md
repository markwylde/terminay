## MODIFIED Requirements

### Requirement: Server-owned authorization and client subscription

Terminal and project authorization, canonical validation, ordering, snapshots, acknowledgement, project scoping, and terminal binding SHALL live in Terminay Server. Session detection SHALL live in separately hosted extensions and reach the server only as session-source snapshots through the public Extension API. Connected clients SHALL subscribe to the same ordered reduced snapshot and SHALL NOT read provider files or create competing agent state. A client SHALL subscribe once per connection, and a window SHALL hold that one subscription to its own server. A server's ordered reduced snapshot SHALL NEVER be merged with another server's into one ordered stream, and an entry SHALL NEVER be acknowledged through a connection other than the one that published it.

#### Scenario: Client rendering agent state

- **WHEN** a client displays agent status
- **THEN** it renders the server's ordered reduced snapshot and reads no provider file

#### Scenario: Extension observing a provider

- **WHEN** an extension reports sessions
- **THEN** it uses only the public session-source API and performs no terminal or project authorization

#### Scenario: Subscriptions on several connections

- **WHEN** one device has two windows showing different servers that each publish agent entries
- **THEN** each window holds one subscription on its own connection, renders only the snapshot ordered by its own server, and acknowledges each entry on the connection that published it

### Requirement: Dismissing notifications

Each notification row SHALL carry a dismiss control, and the list SHALL carry a **Clear all** control whenever at least one notification is listed. Dismissing a notification SHALL acknowledge that terminal on the window's server exactly as selecting its tab does, without selecting the terminal or activating its project, so that its terminal tab dot, its project dot, and the header number clear together on every client connected to that server. **Clear all** SHALL do the same for every listed notification. **Clear all** SHALL NOT affect working terminals, whose tab and project dots remain. The list SHALL stay open after a dismissal.

#### Scenario: Dismissing one notification

- **WHEN** a user dismisses a finished notification for a terminal in a background project
- **THEN** the row leaves the list, the header number drops by one, that terminal's tab dot clears, the active project and selected terminal are unchanged, and the list stays open

#### Scenario: Dismissing the last notification of a project

- **WHEN** a user dismisses the only notification in a project that has no working terminal
- **THEN** that project's tab dot hides

#### Scenario: Clear all

- **WHEN** three notifications are listed and one terminal is working, and the user presses **Clear all**
- **THEN** all three notifications are acknowledged on the window's server, the header badge hides, the empty state shows, and the working terminal's tab still shows its working dot

#### Scenario: Dismissal reaches other clients

- **WHEN** two clients are connected to the same server and one dismisses a notification
- **THEN** the notification clears on the other client as well

#### Scenario: Clear all with nothing to clear

- **WHEN** there are no notifications
- **THEN** no **Clear all** control is shown

#### Scenario: Clear all leaves another server alone

- **WHEN** two windows show different servers, each lists a notification, and the user presses **Clear all** in one
- **THEN** only that window's server's notifications are acknowledged and the other window's list is unchanged

## ADDED Requirements

### Requirement: Agents pane shows the current project's agents

The **Agents** pane SHALL be the Agents sidebar group's collapsible pane. It SHALL show the roots that belong to the current project on the window's server, keyed by the project, and SHALL nest children beneath them. Bound and external roots SHALL be listed together in one stable ordering, with external rows carrying the **External** marker. Rows SHALL use the existing tree geometry and SHALL NOT name a server. Missing metadata SHALL be omitted. A generic terminal tab name SHALL NOT be used as the agent title: an untitled root SHALL use the harness label until the source reports a title. The harness label SHALL come from the source's declared harness display names, and the Agents UI SHALL NOT keep a hardcoded map of provider ids.

How an entry's display name, provider and model metadata, and prompt are resolved from a snapshot entry SHALL be one rule shared by every surface that presents an agent, so the same agent SHALL NEVER be named one thing in the Agents pane and another thing on another surface. A surface that presents agents outside one project SHALL apply that same rule rather than its own.

#### Scenario: Root in another project

- **WHEN** a session's working directory is outside the current project and its repository worktrees, and it is not bound to one of the project's terminals
- **THEN** it is not shown in the current project's Agents pane

#### Scenario: Untitled root

- **WHEN** a root has no reported title
- **THEN** it displays the harness display name rather than a generic terminal tab name

#### Scenario: Same project id on a server shown in another window

- **WHEN** another window shows a server that holds a project whose id equals the current project's id and has a root
- **THEN** that root is not shown in the current project's Agents pane

#### Scenario: One agent on two surfaces

- **WHEN** the same bound root is presented in the Agents pane and on a surface that spans projects
- **THEN** both resolve the same display name, the same provider and model metadata, and the same prompt from the same entry

### Requirement: Terminal tab and header agent status

Bound roots SHALL render the canonical RAG glyph on terminal tabs for `working` always, and for `waiting`, `blocked`, and `done` only while those entries are unacknowledged. The header SHALL aggregate unacknowledged meaningful entries of the window's server and of no other server, giving waiting and blocked priority, keeping done until acknowledged, and optionally showing working for navigation. Every aggregated entry SHALL stay keyed by its project, and activating one SHALL act on the window's server.

#### Scenario: Bound root on a tab

- **WHEN** a terminal has a bound agent root that is working
- **THEN** its tab renders the canonical RAG glyph for working

#### Scenario: Unacknowledged done on a tab

- **WHEN** a background terminal has a bound agent root that is `done` and unacknowledged
- **THEN** its tab renders the green RAG glyph

#### Scenario: Acknowledged done on a tab

- **WHEN** a terminal has a bound agent root that is `done` and acknowledged
- **THEN** its tab does not render a done RAG glyph

#### Scenario: Aggregating in the header

- **WHEN** several unacknowledged entries exist
- **THEN** waiting and blocked entries take priority in the header aggregate and done entries remain until acknowledged

#### Scenario: Entries on a server shown in another window

- **WHEN** two windows show different servers and each server holds an unacknowledged waiting entry
- **THEN** each window's header aggregate includes only its own server's entry, and activating it acts only on that server

### Requirement: Header Notifications count

The header SHALL present exactly one Notifications control: an icon button named **Notifications** that is always visible, whether or not anything is listed. The control SHALL carry a single red count badge whose number is the count of notifications — terminals that need attention plus terminals with finished unviewed activity — on the window's server. Terminals of any other server SHALL NOT contribute to the number. Working terminals SHALL NOT contribute to the number. The badge SHALL be hidden when the number is zero. The badge SHALL be a circle of one fixed size regardless of the number it displays, with the number centred, the font size stepping down as the digit count grows, and counts above 99 displayed as `99+`. The control's accessible name SHALL state the number of notifications.

#### Scenario: Notifications of both kinds

- **WHEN** one terminal needs attention and two terminals have finished unviewed activity
- **THEN** the header shows one Notifications icon with a single red badge reading `3`

#### Scenario: Working terminals are not counted

- **WHEN** four terminals are working and nothing needs attention or has finished unviewed
- **THEN** the Notifications icon is visible with no badge

#### Scenario: Nothing at all

- **WHEN** no terminal is working, needs attention, or has finished unviewed activity
- **THEN** the Notifications icon is still visible with no badge, and it can be opened

#### Scenario: Counting only the window's server

- **WHEN** one window shows a server with two finished unviewed terminals and another window shows a server with one terminal needing attention
- **THEN** the first window's badge reads `2` and the second window's badge reads `1`

#### Scenario: Count capped at 99+

- **WHEN** more than 99 terminals have finished unviewed activity
- **THEN** the badge reads `99+` and its width still equals its height

### Requirement: Notifications list contents

Opening the Notifications control SHALL show the list of notifications of the window's server, attention before finished, newest first within each, each row keyed by its project. A row SHALL read as a notification: its status dot, a headline saying what happened in that terminal (an agent finishing, waiting, or blocked; a command finishing; a terminal needing attention), the terminal's title and its project, and how long ago it happened when that time is known. A row SHALL NOT name a server. Working terminals SHALL NOT appear in the list. When there are no notifications the list SHALL show an empty state reading that there are no notifications. Activating a row SHALL select that terminal, as selecting its tab does, and close the list. The list's contents SHALL be governed by the **Show indicator for active tabs** and **Show indicator for finished tabs** settings.

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

- **WHEN** a user activates a finished row for a terminal in a background project
- **THEN** that project is activated, that terminal is selected, the list closes, and the notification clears as it would on clicking that terminal's tab

#### Scenario: A terminal on a server shown in another window

- **WHEN** two windows show different servers and each server holds a terminal needing attention
- **THEN** each window's list shows only its own server's row, naming the terminal and its project and no server

## REMOVED Requirements

### Requirement: Agents pane presentation

**Reason**: One of its scenarios describes a second server held by the same window, and a window shows one server.

**Migration**: Restated for one server per window as "Agents pane shows the current project's agents".

### Requirement: Terminal tab and header status surfaces

**Reason**: Its header aggregate and one of its scenarios span several servers held by one window, and a window shows one server.

**Migration**: Restated for one server per window as "Terminal tab and header agent status".

### Requirement: Header Notifications control

**Reason**: Its count and one of its scenarios span several servers held by one window, and a window shows one server.

**Migration**: Restated for one server per window as "Header Notifications count".

### Requirement: Notifications list

**Reason**: Its rows and one of its scenarios name and span several servers held by one window, and a window shows one server.

**Migration**: Restated for one server per window as "Notifications list contents".
