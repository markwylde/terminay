## MODIFIED Requirements

### Requirement: Tab identity, styling, and actions

A tab SHALL be renameable and styleable with colour, emoji, terminal-theme controls, and an optional note. Double-clicking the tab or long-pressing it SHALL open that editor. The editor SHALL stay reachable at a width where no tab strip is drawn: a long press on the active terminal's row in the compact switcher SHALL open it, and the **Edit Active Tab** command SHALL open it for the terminal in front. Tab context actions SHALL expose terminal-specific actions such as recording and moving the tab to another project.

#### Scenario: Opening the tab editor

- **WHEN** the user double-clicks or long-presses a terminal tab
- **THEN** the editor opens with rename, colour, emoji, terminal-theme controls, and an optional note

#### Scenario: Opening the tab editor where no tab strip is drawn

- **WHEN** a user long-presses a terminal row in the compact switcher
- **THEN** that terminal's editor opens with the same controls, and the terminal is not merely activated

#### Scenario: Opening the tab editor by command

- **WHEN** a user invokes **Edit Active Tab** with a terminal in front
- **THEN** that terminal's editor opens

#### Scenario: Tab context menu

- **WHEN** the user opens a terminal tab's context actions
- **THEN** terminal-specific actions such as recording and moving to another project are available
