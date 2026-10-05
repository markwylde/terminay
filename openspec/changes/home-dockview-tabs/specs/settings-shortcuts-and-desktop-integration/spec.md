## MODIFIED Requirements

### Requirement: Command Bar contents

The Command Bar SHALL search built-in commands, saved macros, and places. Built-ins SHALL honour the active panel and project requirement and SHALL display user-configured shortcuts. Commands that act on the workspace view rather than a panel, including **Show Dashboard**, SHALL remain available when no panel or project is active.

Places SHALL be Home's sections and every project, tab, and agent of every attached connection, and every automation of every connection that serves automations. Place matching SHALL be case-insensitive substring matching over names, SHALL rank a match at the start of a name or word above one elsewhere, and SHALL return nothing for an empty search, so that the Command Bar opens showing commands and macros alone. Results SHALL be grouped, with commands and macros first and then places by kind — sections, projects, tabs, agents, automations — each kind bounded. Choosing a place SHALL go to it: a section opens as a Home tab, a project or tab is activated as a dashboard row is, an agent as a dashboard agent is, and an automation opens in its Home tab. With more than one connection attached, a place SHALL name the server it belongs to.

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
