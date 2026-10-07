## MODIFIED Requirements

### Requirement: Command Bar contents

The Command Bar SHALL search built-in commands, saved macros, and places. Built-ins SHALL honour the active panel and project requirement and SHALL display user-configured shortcuts. Commands that act on the workspace view rather than a panel, including **Show Dashboard**, SHALL remain available when no panel or project is active.

Places SHALL be Home's sections and every project, tab, and agent of the window's server, and every automation of that server where it serves automations. Place matching SHALL be case-insensitive substring matching over names, SHALL rank a match at the start of a name or word above one elsewhere, and SHALL return nothing for an empty search, so that the Command Bar opens showing commands and macros alone. Results SHALL be grouped, with commands and macros first and then places by kind — sections, projects, tabs, agents, automations — each kind bounded. Choosing a place SHALL go to it: a section opens as a Home tab, a project or tab is activated as a dashboard row is, an agent as a dashboard agent is, and an automation opens in its Home tab. A place SHALL NOT carry a server name, and no place of any other server SHALL be listed.

The Command Bar SHALL open whichever view is selected, including Home and a window that holds no project. A command that requires a project SHALL be left out of the results when no project is in front: while Home is selected, and when the window holds no project.

#### Scenario: Searching the Command Bar

- **WHEN** a user searches the Command Bar
- **THEN** built-in commands and saved macros are returned with their user-configured shortcuts shown

#### Scenario: Command requiring an active panel

- **WHEN** a built-in command requires an active panel or project that is not present
- **THEN** the command honours that requirement rather than running

#### Scenario: View-scoped command without an active panel

- **WHEN** a user runs **Show Dashboard** with no active panel
- **THEN** it runs rather than being withheld

#### Scenario: Finding a tab in another project

- **WHEN** a user types part of a tab's title into the Command Bar and chooses that tab
- **THEN** the Command Bar closes, that tab's project is selected, and the tab is focused

#### Scenario: Finding an automation

- **WHEN** a user types part of an automation's name into the Command Bar while a project is in front and chooses it
- **THEN** Home is selected and that automation's tab is in front

#### Scenario: Opening with nothing typed

- **WHEN** a user opens the Command Bar and has typed nothing
- **THEN** commands and macros are listed and no places are

#### Scenario: Opening on Home

- **WHEN** a user presses the Command Bar shortcut while Home is selected
- **THEN** the Command Bar opens over Home, lists view-scoped commands, and lists no command that requires a project

#### Scenario: No project in the window

- **WHEN** a user opens the Command Bar in a window that holds no project
- **THEN** it opens, lists view-scoped commands and places, and lists no command that requires a project

#### Scenario: Places of another server

- **WHEN** a user searches the Command Bar for the name of a project that exists only on a server the window is not showing
- **THEN** no place is returned for it

### Requirement: Server settings client boundary

The shared terminal-settings hook SHALL read and observe server settings through the transport-neutral `SettingsClient` of the window's connection. The host bridge SHALL NOT answer or translate server settings operations. Shared components SHALL NOT subscribe to preload events directly. No terminal-settings preload global or snapshot adapter SHALL exist, and a missing settings authority on the window's server SHALL be reported as unavailable rather than falling back to device-local settings or to another server.

#### Scenario: Reading server settings

- **WHEN** a shared component reads or observes server settings
- **THEN** it uses the `SettingsClient` of the window's connection

#### Scenario: Settings authority missing

- **WHEN** the window's server's settings authority is unavailable
- **THEN** the condition is reported as unavailable and no device-local fallback is used

#### Scenario: Another connection is not a fallback

- **WHEN** the window's connection cannot answer a settings operation
- **THEN** the operation is not sent to any other server the device knows

## REMOVED Requirements

### Requirement: Settings and Extensions surfaces select a server

**Reason**: A window shows one server, so Settings and Extensions always presents that server and has nothing to select.

**Migration**: See "Every workspace surface covers the window's server" in `connections-and-client-hosts`. To work with another server's Settings and Extensions, switch the window to that server or open it in a new window.
